---
name: code-crawl
description: Use when you need to read a large body of code or text fast and cheaply — whole subsystems, sprawling logs, many files — by fanning the work out across parallel glm-code-crawler shards via cc-proxy and merging the digests. You orchestrate the shards; the agent reads one shard each. Requires cc-proxy running. Give it the paths/globs and the crawl question.
---

# Code Crawl

Read a large path/glob set fast by sharding it across parallel `glm-code-crawler` agents on the cheap `glm-5-turbo` tier, then merging the shard digests. You (the main model) own sharding and merging — the agent does not fan out.

## Tunable knobs (edit here to retune the crawl)

- **Per-shard budget:** ~**150K characters** (~40K tokens) of source per shard — comfortably under glm-5-turbo's 200K input window. Never split a single file across shards; a file larger than the budget becomes its own shard.
- **Wave cap:** at most **6** parallel Agent calls at once. There is no scheduler — enforce the cap yourself by dispatching in waves.

## Procedure

1. **Preflight: is the proxy up?** Run:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/hooks/proxy-ready.sh"
   ```

   Non-zero exit → STOP and tell the user to start cc-proxy.

2. **Enumerate & shard.** Expand the target paths/globs to a concrete file list (use `ls`/`find`/Glob). Greedily pack files into shards up to the ~150K-char budget, keeping each whole. Record which files landed in each shard.

3. **Dispatch in waves of ≤ 6.** Dispatch up to 6 `glm-code-crawler` Agent calls in one message, each given the explicit file list for its shard plus the crawl question. **Await the wave**, then dispatch the next 6, until all shards are done. Never drop shards — extra shards are a later wave, not a truncation. If you must cap total work, say so explicitly to the user.

4. **Merge.** Combine the shard digests into one answer: union the Findings, keep `path:line` cites, and carry forward any Gaps a shard flagged (another shard may have covered them — reconcile). Note confirmed vs inferred.

5. **Report** the merged digest, noting it was a glm-5-turbo crawl — verify load-bearing claims before acting.
