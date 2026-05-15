"""Enrich web/data.js with structured records of people who reached outlier success.

Reads a seed list of names (data/seed_people.txt) and produces a structured
record per person via Claude. Resumable: skips slugs already present in data.js.
Uses prompt caching on the system prompt + tool schema, since they are identical
across every call.

Usage:
    pip install -r requirements.txt
    export ANTHROPIC_API_KEY=sk-...
    python enrich.py --limit 10   # try a few first
    python enrich.py              # do the rest
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

from anthropic import Anthropic

ROOT = Path(__file__).resolve().parent.parent
SEED_FILE = ROOT / "_tools" / "seed_people.txt"
DATA_FILE = ROOT / "data.js"

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024

TOOL = {
    "name": "person_record",
    "description": "Structured biographical record of someone who reached outlier success, for similarity-based matching.",
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "category": {
                "type": "string",
                "enum": ["founder", "athlete", "musician", "author", "scientist", "director", "media"],
                "description": "Best-fit category for this person's outlier success."
            },
            "achievement": {
                "type": "string",
                "description": "Short verb-phrase of what they did. Examples: 'Founded Stripe', 'Won her first Grand Slam', 'Published Harry Potter and the Philosopher\\'s Stone'. The UI displays this followed by 'at age N'."
            },
            "achievement_year": {"type": "integer"},
            "age_at_achievement": {
                "type": "integer",
                "description": "Age in years at the achievement."
            },
            "country_of_origin": {
                "type": "string",
                "description": "Country where the person was born or raised, not necessarily where they had their success. Use the distinctive heritage if it differs from where they ended up."
            },
            "education_level": {
                "type": "string",
                "enum": ["no_college", "dropout", "bachelors", "graduate"],
                "description": "Highest education level completed before the achievement. Use 'dropout' if they enrolled in college but did not finish."
            },
            "education_institution": {
                "type": ["string", "null"],
                "description": "Most relevant institution attended (university name), or null if no college."
            },
            "prior_failures": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Notable failed ventures, rejections, or significant career setbacks before this achievement. Empty array if none well-documented. Be honest but do not invent. Do not use em-dashes in the text."
            },
            "story": {
                "type": "string",
                "description": "One or two sentences, inspirational tone, that emphasize how relatable or normal the person was when they started. Focus on the similarity hook. Do not use em-dashes."
            },
            "notability": {
                "type": "string",
                "description": "Short display string of what makes them famous. For founders: peak market cap or valuation. For athletes: championships or records. For artists: total works sold or major awards. Examples: '$1.3T peak market cap', '6× NBA Champion', '600M+ books sold'."
            }
        },
        "required": [
            "name", "category", "achievement", "achievement_year", "age_at_achievement",
            "country_of_origin", "education_level", "prior_failures", "story", "notability"
        ]
    }
}

SYSTEM = """You produce structured biographical records of people who reached outlier success. This includes founders of $1B+ companies, world-class athletes, Nobel laureates, best-selling authors, iconic musicians, top film directors, and other people at the top of their fields. The website "I Can Do It Too" helps users find people who started like them: same age at breakthrough, same country, same education level, same number of prior failures.

Rules:
- Be accurate. If you are uncertain about a specific fact (e.g. exact age at the achievement), make your best estimate from widely-reported birth year and event year.
- Do not invent prior failures. Only list documented ones. An empty array is fine and common.
- The 'story' field is one or two sentences, inspirational and similarity-focused. Lead with what made the person "normal" or relatable. Avoid generic praise.
- Never use em-dashes. Use periods, semicolons, colons, or commas instead.
- Return your answer by calling the person_record tool exactly once."""


def load_existing():
    if not DATA_FILE.exists():
        return []
    text = DATA_FILE.read_text(encoding="utf-8")
    m = re.search(r"window\.PEOPLE\s*=\s*(\[.*\])\s*;?\s*$", text, re.DOTALL)
    if not m:
        return []
    return json.loads(m.group(1))


def save_all(records):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(records, indent=2, ensure_ascii=False)
    DATA_FILE.write_text(f"window.PEOPLE = {serialized};\n", encoding="utf-8")


def slugify(name):
    s = name.lower()
    s = re.sub(r"[áàâä]", "a", s)
    s = re.sub(r"[éèêë]", "e", s)
    s = re.sub(r"[íìîï]", "i", s)
    s = re.sub(r"[óòôö]", "o", s)
    s = re.sub(r"[úùûü]", "u", s)
    s = re.sub(r"[ñ]", "n", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def load_seed():
    if not SEED_FILE.exists():
        sys.exit(f"Seed file not found: {SEED_FILE}")
    lines = SEED_FILE.read_text(encoding="utf-8").splitlines()
    names = []
    seen = set()
    for line in lines:
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s in seen:
            continue
        seen.add(s)
        names.append(s)
    return names


def enrich_one(client, name):
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=[
            {
                "type": "text",
                "text": SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[{**TOOL, "cache_control": {"type": "ephemeral"}}],
        tool_choice={"type": "tool", "name": "person_record"},
        messages=[
            {
                "role": "user",
                "content": f"Produce the person_record for: {name}",
            }
        ],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == "person_record":
            record = dict(block.input)
            record["id"] = slugify(record["name"])
            return record, response.usage
    raise RuntimeError(f"No tool use returned for {name}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Only enrich N new people this run.")
    parser.add_argument("--force", action="store_true", help="Re-enrich people already in data.js.")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key, then source it.")

    client = Anthropic(api_key=api_key)
    existing = load_existing()
    existing_by_id = {r["id"]: r for r in existing}
    names = load_seed()

    queue = []
    for name in names:
        sid = slugify(name)
        if sid in existing_by_id and not args.force:
            continue
        queue.append(name)

    if args.limit is not None:
        queue = queue[: args.limit]

    print(f"Existing dataset: {len(existing)}. Queue to enrich: {len(queue)}.")
    if not queue:
        print("Nothing to do.")
        return

    cache_hits = 0
    cache_writes = 0
    for i, name in enumerate(queue, 1):
        try:
            record, usage = enrich_one(client, name)
            existing_by_id[record["id"]] = record
            records = sorted(existing_by_id.values(), key=lambda r: r["id"])
            save_all(records)
            cache_hits += getattr(usage, "cache_read_input_tokens", 0) or 0
            cache_writes += getattr(usage, "cache_creation_input_tokens", 0) or 0
            print(
                f"[{i}/{len(queue)}] {name} -> {record['achievement']} "
                f"(age {record['age_at_achievement']}, {record['country_of_origin']})"
            )
        except Exception as e:
            print(f"[{i}/{len(queue)}] {name} FAILED: {e}", file=sys.stderr)
        time.sleep(0.1)

    print(
        f"Done. {len(existing_by_id)} total in dataset. "
        f"Cache: {cache_hits} read tokens, {cache_writes} write tokens."
    )


if __name__ == "__main__":
    main()
