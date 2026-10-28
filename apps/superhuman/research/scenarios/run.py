#!/usr/bin/env python3
"""Run controlled demo UI scenarios through the pinned REA CLI, never raw CDP."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
from urllib.parse import urlsplit, urlencode

SCENARIOS = Path(__file__).resolve().parent
ROOT = SCENARIOS.parents[3]
DEFAULT_CASES = ["draft-save-reopen", "search-jordan", "command-keyboard", "archive-undo-native-button", "narrow-viewport", "attachment-draft", "reply-all", "reminder-undo", "label-picker", "rich-compose", "inline-ai-unconfigured", "side-ai-unconfigured", "calendar-week", "calendar-create-edit-delete", "recipient-editing", "contact-context"]
CALENDAR_CASES = {"calendar-week", "calendar-create-edit-delete"}
DRAFT_SUBJECT = "REA E2E draft persistence"
API_ORIGIN = "http://127.0.0.1:3001"
WEB_ORIGIN = "http://127.0.0.1:5173"


def source_manifest():
    paths = [ROOT / "package-lock.json", ROOT / "package.json"]
    for project in ["web", "api"]:
        directory = ROOT / "apps/superhuman" / project
        paths.append(directory / "package.json")
        paths.extend(path for path in (directory / "src").rglob("*") if path.is_file() and path.suffix in (".ts", ".tsx", ".css"))
    paths.append(ROOT / "apps/superhuman/web/vite.config.ts")
    paths.extend((ROOT / "apps/superhuman/web/test").glob("calendar-fixture.*"))
    paths.extend(SCENARIOS.glob("*.json"))
    paths.extend([SCENARIOS / "run.py", SCENARIOS / "prepare-attachment.mjs", ROOT / "scripts/superhuman-demo-test-server.sh"])
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}


def changed_sources(before, after):
    return sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))


def loopback_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or
            parsed.username or parsed.password or parsed.path not in ("", "/") or
            parsed.query or parsed.fragment or not parsed.port):
        raise argparse.ArgumentTypeError("Use an explicit http://127.0.0.1:PORT origin")
    return f"http://127.0.0.1:{parsed.port}"


def bootstrap():
    with urllib.request.urlopen(API_ORIGIN + "/api/bootstrap", timeout=10) as response:
        data = json.load(response)
    assert data["activeAccountId"] == "demo", "Refusing to run on a live account"
    assert data["accounts"] and all(a["provider"] == "demo" for a in data["accounts"]), "Only demo providers are allowed"
    assert all(t["accountId"] == "demo" for t in data["threads"]), "Live thread found"
    return data



def unconfigured_ai_history():
    """Read only demo account metadata. Never enables or calls an AI provider."""
    def read(path):
        with urllib.request.urlopen(API_ORIGIN + path, timeout=10) as response:
            return json.load(response)
    status = read("/api/ai/chat/status?accountId=demo")["status"]
    assert status["configured"] is False, "Unconfigured AI case refuses an enabled provider"
    sessions, cursor = [], None
    for _ in range(100):
        page = read("/api/ai/chat/sessions?" + urlencode({"accountId": "demo", "limit": 50, **({"cursor": cursor} if cursor else {})}))
        assert all(item["accountId"] == "demo" for item in page["sessions"])
        sessions.extend(page["sessions"])
        cursor = page["nextCursor"]
        if not cursor:
            return {"status": status, "sessions": sessions}
    raise AssertionError("Demo AI history exceeded the bounded metadata audit")


def request_assertions(name, events):
    if name != "reply-all":
        return {}
    requests = [e for e in events if e.get("kind") == "request" and e.get("method") == "POST" and e.get("url", {}).get("url", "").endswith("/api/threads/demo-thread-1/reply")]
    matching = set(e["transaction_id"] for e in requests)
    responses = [e for e in events if e.get("kind") == "response" and e.get("transaction_id") in matching and e.get("status") == 201]
    bodies = [e.get("body", {}) for e in events if e.get("kind") == "network-content" and e.get("transaction_id") in matching and e.get("phase") == "request"]
    decoded = [json.loads(base64.b64decode(body["content"])) for body in bodies if body.get("state") == "captured" and body.get("encoding") == "base64"]
    return {"reply_endpoint_post_201": bool(responses), "reply_all_mode_captured": {"mode": "replyAll"} in decoded}


def run_case(name, output):
    case_path = SCENARIOS / f"{name}.json"
    assert case_path.is_file() and case_path.parent == SCENARIOS
    scenario = json.loads(case_path.read_text())
    # REA's connected Playwright session has no default action deadline. Bound
    # interactions explicitly so a missing exact accessible name is a failure,
    # not an indefinitely blocked capture with no returned evidence.
    for action in scenario["actions"]:
        if action["action"] in ("click", "press", "fill", "wait_for", "goto"):
            action.setdefault("timeout_ms", 10000)
    scenario = json.loads(json.dumps(scenario).replace("http://127.0.0.1:5173", WEB_ORIGIN))
    scenario = json.loads(json.dumps(scenario).replace("__RICH_COMPOSE_SUBJECT__", "REA rich composer " + output.name))
    scenario = json.loads(json.dumps(scenario).replace("__INLINE_AI_SUBJECT__", "REA inline AI " + output.name))
    scenario = json.loads(json.dumps(scenario).replace("__SIDE_AI_SUBJECT__", "REA side AI " + output.name))
    scenario = json.loads(json.dumps(scenario).replace("__AI_UNSENT_PROMPT__", "Unsent fictional question " + output.name))
    scenario = json.loads(json.dumps(scenario).replace("__RECIPIENT_SUBJECT__", "REA recipients " + output.name))
    scenario = json.loads(json.dumps(scenario).replace("__CONTACT_SUBJECT__", "REA contact context " + output.name))
    # Every run gets its own saved draft, so a persistent old test record cannot
    # make an otherwise correct locator ambiguous. Retain the instantiated input.
    if name == "draft-save-reopen":
        scenario = json.loads(json.dumps(scenario).replace(DRAFT_SUBJECT, DRAFT_SUBJECT + " " + output.name))
    if name == "attachment-draft":
        prepared = json.loads(subprocess.check_output(["node", str(SCENARIOS / "prepare-attachment.mjs"), output.name, API_ORIGIN], cwd=ROOT, text=True, timeout=30))
        (output / "attachment-api-check.json").write_text(json.dumps(prepared, indent=2))
        scenario = json.loads(json.dumps(scenario).replace("__ATTACHMENT_DRAFT_SUBJECT__", prepared["draftSubject"]))
    case_path = output / f"{name}.scenario.json"
    case_path.write_text(json.dumps(scenario, indent=2))
    assert scenario["browser"]["mode"] == "launch"
    assert scenario["start_url"]["url"] == WEB_ORIGIN + ("/test/calendar-fixture.html" if name in CALENDAR_CASES else "")
    assert all(a["action"] != "request" for a in scenario["actions"])
    bootstrap()
    ai_before = unconfigured_ai_history() if name == "side-ai-unconfigured" else None
    if ai_before is not None:
        (output / "side-ai-history-before.json").write_text(json.dumps(ai_before, indent=2))
    source = ROOT / "apps/superhuman/web/src/App.tsx"
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest = source_manifest()
    capture_failure = None
    with (output / f"{name}.json").open("w") as evidence, (output / f"{name}.stderr.txt").open("w") as diagnostics:
        try:
            completed = subprocess.run(["npm", "run", "--silent", "rea", "--", "capture-browser-scenario", str(case_path), "--json"], cwd=ROOT, stdout=evidence, stderr=diagnostics, timeout=180)
        except subprocess.TimeoutExpired:
            capture_failure = "Host deadline expired without a completed REA result; inspect owned resources before launching another capture."
    try:
        record = json.loads((output / f"{name}.json").read_text()) if not capture_failure else {}
    except json.JSONDecodeError:
        capture_failure = "CLI did not return a complete JSON result; retained output is not REA Evidence. Inspect cleanup before another capture."
        record = {}
    if capture_failure:
        changes = changed_sources(manifest, source_manifest())
        summary = {"case": name, "passed": False, "evidence_id": None, "capture_unavailable": True, "error": capture_failure, "browser_cleanup": "not-established", "source_changes": changes}
        (output / f"{name}.capture-failure.json").write_text(json.dumps(summary, indent=2))
        print(json.dumps(summary), flush=True)
        return summary
    result = record.get("normalized_result", {})
    steps = result.get("steps", [])
    failed = [{"step": s["step_id"], "status": s["status"], "error": s.get("error")} for s in steps if s["status"] != "completed"]
    page_errors = [e for e in result.get("events", {}).get("items", []) if e.get("kind") == "page-error"]
    network_checks = request_assertions(name, result.get("events", {}).get("items", []))
    if ai_before is not None:
        ai_after = unconfigured_ai_history()
        (output / "side-ai-history-after.json").write_text(json.dumps(ai_after, indent=2))
        previous = {item["id"]: item["turnCount"] for item in ai_before["sessions"]}
        added = [item for item in ai_after["sessions"] if item["id"] not in previous]
        network_checks.update(
            local_ai_session_created_without_generation=bool(added) and all(item["turnCount"] == 0 for item in added),
            no_ai_turn_added_while_unconfigured=all(item["turnCount"] == previous.get(item["id"], 0) for item in ai_after["sessions"]),
        )
    screenshots = []
    for step in steps:
        artifacts = step.get("artifacts", {})
        screenshot = artifacts.get("screenshot", {})
        if screenshot.get("state") == "captured":
            filename = f"{name}-{step['step_id']}.png"
            (output / filename).write_bytes(base64.b64decode(screenshot["value"]["data_base64"]))
            screenshots.append(filename)
        for kind in ["dom", "accessibility"]:
            artifact = artifacts.get(kind, {})
            if artifact.get("state") == "captured":
                (output / f"{name}-{step['step_id']}.{kind}.txt").write_text(artifact["value"]["text"])
    source_hash_after = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest_after = source_manifest()
    source_changes = changed_sources(manifest, manifest_after)
    manifest_path = output / f"{name}.sources.json"
    manifest_path.write_text(json.dumps({"before": manifest, "after": manifest_after, "changed": source_changes}, indent=2))
    passed = completed.returncode == 0 and len(steps) == len(scenario["actions"]) + 1 and not failed and not page_errors and not source_changes and all(network_checks.values())
    summary = {"case": name, "passed": passed, "evidence_id": record.get("evidence_id"), "process_exit": completed.returncode, "steps": len(steps), "expected_steps": len(scenario["actions"]) + 1, "failed": failed, "page_errors": page_errors, "request_assertions": network_checks, "error": record.get("error"), "input_diagnostics": record.get("details"), "completeness": result.get("completeness"), "browser_cleanup": result.get("browser", {}).get("cleanup"), "screenshots": screenshots, "app_source_sha256": source_hash, "app_source_after_sha256": source_hash_after}
    summary.update(source_manifest=manifest_path.name, source_changes=source_changes)
    print(json.dumps(summary), flush=True)
    return summary


def main():
    global API_ORIGIN, WEB_ORIGIN
    parser = argparse.ArgumentParser()
    parser.add_argument("cases", nargs="*", choices=DEFAULT_CASES + ["baseline"])
    parser.add_argument("--api-origin", type=loopback_origin, default=API_ORIGIN)
    parser.add_argument("--web-origin", type=loopback_origin, default=WEB_ORIGIN)
    args = parser.parse_args()
    API_ORIGIN, WEB_ORIGIN = args.api_origin, args.web_origin
    assert json.loads((ROOT / "package.json").read_text())["name"] == "reverse-engineering"
    output = ROOT / "apps/superhuman/evidence/private/replica-e2e" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output.mkdir(parents=True)
    print("Evidence directory: " + str(output), flush=True)
    before = bootstrap()
    initial_manifest = source_manifest()
    (output / "before.json").write_text(json.dumps(before, indent=2))
    summaries = []
    for name in args.cases or DEFAULT_CASES:
        summary = run_case(name, output)
        summaries.append(summary)
        if summary.get("capture_unavailable"):
            break  # Unknown cleanup must not be followed by another owned browser.
    after = bootstrap()
    final_manifest = source_manifest()
    run_source_changes = changed_sources(initial_manifest, final_manifest)
    (output / "sources.json").write_text(json.dumps({"before": initial_manifest, "after": final_manifest, "changed": run_source_changes}, indent=2))
    (output / "after.json").write_text(json.dumps(after, indent=2))
    assertions = {}
    if "draft-save-reopen" in (args.cases or DEFAULT_CASES):
        drafts = [d for d in after["drafts"] if d["subject"] == DRAFT_SUBJECT + " " + output.name + " edited"]
        assertions["persisted_edited_draft"] = bool(drafts) and any(d["to"] == "qa-recipient@example.test" and d["body"] == "Synthetic REA browser test. No delivery requested." for d in drafts)
    if "archive-undo-native-button" in (args.cases or DEFAULT_CASES):
        assertions["jordan_restored_to_inbox"] = any(t["id"] == "demo-thread-1" and t["folder"] == "inbox" for t in after["threads"])
    if "rich-compose" in (args.cases or DEFAULT_CASES):
        drafts = [d for d in after["drafts"] if d["subject"] == "REA rich composer " + output.name]
        assertions["rich_draft_persisted"] = bool(drafts) and any(
            d["to"] == "qa-recipient@example.test" and "REA formatting sample" in d["body"]
            and all(marker in d.get("html", "") for marker in ["https://example.com/rea-formatting", "<blockquote", "<ol", "222"])
            for d in drafts)
    if "inline-ai-unconfigured" in (args.cases or DEFAULT_CASES):
        drafts = [d for d in after["drafts"] if d["subject"] == "REA inline AI " + output.name]
        assertions["unconfigured_ai_kept_draft"] = bool(drafts) and any(d["body"] == "Synthetic selection stays safe when AI is unavailable." and d["status"] == "draft" for d in drafts)
    if "side-ai-unconfigured" in (args.cases or DEFAULT_CASES):
        drafts = [d for d in after["drafts"] if d["subject"] == "REA side AI " + output.name]
        assertions["side_ai_error_did_not_replace_draft"] = bool(drafts) and any(d["body"] == "Synthetic draft stays safe when Claude is unavailable." and d["status"] == "draft" for d in drafts)
    if "recipient-editing" in (args.cases or DEFAULT_CASES):
        drafts = [d for d in after["drafts"] if d["subject"] == "REA recipients " + output.name]
        assertions["recipient_headers_persisted"] = bool(drafts) and any(
            d["to"] == "rea-two@example.test" and d["cc"] == "rea-cc@example.test, rea-edited@example.test"
            and d["bcc"] == "rea-bcc@example.test"
            for d in drafts)
        assertions["recipient_body_fixture_persisted"] = bool(drafts) and any(d["body"] == "Synthetic recipient editing comparison. No delivery requested." for d in drafts)
    if "contact-context" in (args.cases or DEFAULT_CASES):
        drafts = [d for d in after["drafts"] if d["subject"] == "REA contact context " + output.name]
        assertions["contact_navigation_kept_draft"] = bool(drafts) and any(
            d["to"] == "Jordan Lee <jordan@example.test>" and not d["cc"] and not d["bcc"]
            and d["body"] == "Contact context retained editor history." and d["status"] == "draft"
            for d in drafts)
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "cases": summaries, "state_assertions": assertions, "passed": all(s["passed"] for s in summaries) and all(assertions.values()), "limits": ["Synthetic demo data only", "No original behavior comparison", "No provider delivery or OAuth exercised", "Assertions inspect only declared UI states and persisted demo values"]}
    report.update(source_changes=run_source_changes)
    report["skipped_cases"] = [name for name in args.cases or DEFAULT_CASES if name not in {summary["case"] for summary in summaries}]
    report["passed"] = report["passed"] and not run_source_changes
    (output / "report.json").write_text(json.dumps(report, indent=2))
    print("Report: " + str(output / "report.json"), flush=True)
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
