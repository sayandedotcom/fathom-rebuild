#!/usr/bin/env python3
"""Capture every prompt and final response of a Claude Code session into .agent-logs/.

Wired to SessionStart, UserPromptSubmit and Stop in .claude/settings.json, so it
fires on its own. One markdown file per session:
    .agent-logs/YYYY-MM-DD_HH-MM-SS_<session-id>.md

- UserPromptSubmit appends the prompt verbatim (from the hook payload).
- Stop reads the session transcript and appends the final assistant text of the
  turn (text after the last tool call), never thinking or tool traffic.
- If the session's log does not exist yet (hook installed mid-session, or a
  resumed session), earlier turns are backfilled from the transcript first.

The hook never blocks Claude Code: all errors go to ~/.cache/agent-capture/errors.log.
"""
import fcntl
import glob
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone

AUTHOR = "sayandedotcom"
TOOL = "claude-code"
PROJECT = "fathom-rebuild"
CACHE_DIR = os.path.expanduser("~/.cache/agent-capture")
HEADER_END = "\n---\n\n"


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def project_dir(payload):
    return os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd()


# ---------------------------------------------------------------- transcript

def read_transcript(path):
    entries = []
    if not path or not os.path.exists(path):
        return entries
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                entries.append(json.loads(line))
            except ValueError:
                pass
    return entries


def prompt_text(entry):
    """Return the text of a human-typed prompt entry, or None."""
    if entry.get("type") != "user" or entry.get("isMeta") or entry.get("isSidechain"):
        return None
    if (entry.get("origin") or {}).get("kind") != "human":
        return None
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return None
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(parts) if parts else None
    return None


def turns(entries):
    """Split a transcript into turns: prompt + final response text + model."""
    out = []
    cur = None
    for e in entries:
        if e.get("isSidechain"):
            continue
        text = prompt_text(e)
        if text is not None:
            cur = {"prompt": text, "prompt_ts": e.get("timestamp"), "final": [],
                   "response_ts": None, "model": None, "queued": []}
            out.append(cur)
            continue
        if cur is None:
            continue
        att = e.get("attachment") or {}
        if e.get("type") == "attachment" and att.get("type") == "queued_command" \
                and (att.get("origin") or {}).get("kind") == "human" and att.get("prompt"):
            # a message the user typed while this turn was still running
            cur["queued"].append((att.get("timestamp") or e.get("timestamp"), att["prompt"]))
            continue
        msg = e.get("message") or {}
        if e.get("type") == "user":
            content = msg.get("content")
            if isinstance(content, list) and any(
                    isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
                cur["final"] = []  # anything said before a tool result was narration
        elif e.get("type") == "assistant":
            model = msg.get("model")
            if model and model != "<synthetic>":
                cur["model"] = model
            for b in msg.get("content") or []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use":
                    cur["final"] = []
                elif b.get("type") == "text" and b.get("text"):
                    cur["final"].append(b["text"])
                    cur["response_ts"] = e.get("timestamp")
    for t in out:
        t["response"] = "\n\n".join(t.pop("final")).strip()
    return out


def last_model(entries):
    for e in reversed(entries):
        m = (e.get("message") or {}).get("model") if e.get("type") == "assistant" else None
        if m and m != "<synthetic>":
            return m
    return None


# ---------------------------------------------------------------- state + log

def state_path(sid):
    return os.path.join(CACHE_DIR, f"{sid}.json")


def load_state(sid):
    try:
        with open(state_path(sid)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(sid, state):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(state_path(sid), "w") as f:
        json.dump(state, f)


def find_log(logdir, sid):
    hits = sorted(glob.glob(os.path.join(logdir, f"*_{sid}.md")))
    return hits[0] if hits else None


def header(sid, st):
    date = (st.get("first_ts") or utc_now())[:10]
    return (
        "---\n"
        f"session_id: {sid}\n"
        f"date: {date}\n"
        f"author: {AUTHOR}\n"
        f"model: {st.get('model') or 'unknown'}\n"
        f"tool: {TOOL}\n"
        f"project: {PROJECT}\n"
        f"total_exchanges: {st.get('prompts', 0)}\n"
        f"first_prompt_time: {st.get('first_ts') or ''}\n"
        f"last_prompt_time: {st.get('last_ts') or ''}\n"
        "---\n\n"
        f"# Session Log - {date}\n\n"
        f"Session: `{sid[:8]}` | Project: `{PROJECT}` | Author: `{AUTHOR}`"
        + HEADER_END
    )


def entry(kind, num, sid, ts, model, text):
    return (
        f"[LOG_ENTRY type={kind} num={num} session={sid[:8]}]\n"
        f"timestamp: {ts}\n"
        f"model: {model or 'unknown'}\n\n"
        f"{text}\n\n\n"
    )


def write_log(path, sid, st, new_body):
    """Rewrite the header (counts change) and append new entries to the body."""
    body = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            content = f.read()
        marker = content.find("Session: `")
        cut = content.find(HEADER_END, marker)
        body = content[cut + len(HEADER_END):] if cut != -1 else ""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(header(sid, st) + body + new_body)
    os.replace(tmp, path)


def add_prompt(st, sid, ts, model, text):
    st["seen"] = (st.get("seen") or [])[-49:] + [text]
    st["prompts"] = st.get("prompts", 0) + 1
    st.setdefault("first_ts", ts)
    st["last_ts"] = ts
    if model:
        st["model"] = model
    return entry("PROMPT", st["prompts"], sid, ts, model or st.get("model"), text)


def add_response(st, sid, ts, model, text):
    if model:
        st["model"] = model
    st["responded"] = st.get("prompts", 0)
    return entry("RESPONSE", st["prompts"], sid, ts, model or st.get("model"), text)


def ensure_log(logdir, sid, st, entries, exclude_last_prompt=None):
    """Return (path, body) creating the log and backfilling earlier turns if needed."""
    path = find_log(logdir, sid)
    body = ""
    if path:
        return path, body
    past = turns(entries)
    if exclude_last_prompt is not None and past and past[-1]["prompt"] == exclude_last_prompt \
            and not past[-1]["response"]:
        past = past[:-1]
    first_ts = past[0]["prompt_ts"] if past else utc_now()
    st.clear()
    st["model"] = last_model(entries) or st.get("model")
    for t in past:
        body += add_prompt(st, sid, t["prompt_ts"], t["model"], t["prompt"])
        for q_ts, q_text in t["queued"]:
            body += add_prompt(st, sid, q_ts, t["model"], q_text)
        if t["response"]:
            body += add_response(st, sid, t["response_ts"], t["model"], t["response"])
    stamp = datetime.strptime(first_ts[:19], "%Y-%m-%dT%H:%M:%S").strftime("%Y-%m-%d_%H-%M-%S")
    path = os.path.join(logdir, f"{stamp}_{sid}.md")
    st["backfilled_to"] = len(past)
    return path, body


# ---------------------------------------------------------------- events

def on_session_start(payload, sid, st):
    model = payload.get("model")
    if isinstance(model, dict):
        model = model.get("id") or model.get("display_name")
    if model:
        st["model"] = model


def on_prompt(payload, sid, st, logdir):
    entries = read_transcript(payload.get("transcript_path"))
    prompt = payload.get("prompt", "")
    path, body = ensure_log(logdir, sid, st, entries, exclude_last_prompt=prompt)
    model = last_model(entries) or st.get("model")
    body += add_prompt(st, sid, utc_now(), model, prompt)
    write_log(path, sid, st, body)


def on_stop(payload, sid, st, logdir):
    path = find_log(logdir, sid)
    entries = read_transcript(payload.get("transcript_path"))
    turn = None
    for attempt in range(6):  # the final assistant block can land a moment after Stop
        ts = turns(entries)
        turn = ts[-1] if ts else None
        if turn and turn["response"]:
            break
        time.sleep(0.25)
        entries = read_transcript(payload.get("transcript_path"))
    if not path:
        path, body = ensure_log(logdir, sid, st, entries)
        write_log(path, sid, st, body)  # backfill already includes this turn
        return
    body = ""
    for q_ts, q_text in (turn or {}).get("queued", []):
        if q_text not in (st.get("seen") or []):
            body += add_prompt(st, sid, q_ts, (turn or {}).get("model"), q_text)
    text = (turn or {}).get("response") or payload.get("last_assistant_message") or ""
    if not text or (st.get("responded") == st.get("prompts") and st.get("last_response") == text):
        if body:
            write_log(path, sid, st, body)
        return  # nothing new, or a duplicate Stop for the same turn
    body += add_response(st, sid, (turn or {}).get("response_ts") or utc_now(),
                        (turn or {}).get("model"), text)
    st["last_response"] = text
    write_log(path, sid, st, body)


def main():
    payload = json.load(sys.stdin)
    sid = payload.get("session_id") or "unknown-session"
    event = payload.get("hook_event_name") or (sys.argv[1] if len(sys.argv) > 1 else "")
    logdir = os.path.join(project_dir(payload), ".agent-logs")
    os.makedirs(logdir, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(os.path.join(CACHE_DIR, f"{sid}.lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        st = load_state(sid)
        if st and not find_log(logdir, sid):
            st = {"model": st.get("model")}
        if event == "SessionStart":
            on_session_start(payload, sid, st)
        elif event == "UserPromptSubmit":
            on_prompt(payload, sid, st, logdir)
        elif event == "Stop":
            on_stop(payload, sid, st, logdir)
        save_state(sid, st)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(os.path.join(CACHE_DIR, "errors.log"), "a") as f:
            f.write(f"{utc_now()}\n{traceback.format_exc()}\n")
    sys.exit(0)
