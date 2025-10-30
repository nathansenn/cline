# Quick Start: Cline Orchestration with Claude Code

This guide will get you up and running with the Cline orchestration system in 5 minutes.

## What This Does

This system lets Claude Code monitor Cline's execution and automatically determine what needs to happen next. Think of Claude Code as a supervisor that:

- Watches Cline work in real-time
- Detects when Cline stops or needs input
- Analyzes the situation and recommends next steps
- Optionally provides responses to keep Cline going

## Prerequisites

1. **Cline** running in VS Code with an active task
2. **Node.js and TypeScript** installed
3. **Claude Code CLI** (optional, for automated analysis)

## Step 1: Check Current Cline State

First, let's see what Cline is currently doing:

```bash
cd /home/user/cline
npx ts-node scripts/monitor-cline.ts --text
```

You should see output like:

```
================================================================================
CLINE TASK MONITOR - 2025-10-30T10:30:00.000Z
================================================================================
Task ID: abc123-def456-...
Description: Fix type errors in the codebase
Status: waiting_for_input
Needs Intervention: YES
Waiting On: I found 15 type errors. Should I fix them all?

Tokens: 1250 in / 850 out
Total Cost: $0.0234

Recent Messages (last 10):
--------------------------------------------------------------------------------
[2025-10-30T10:29:45.000Z] say
  SAY: I'm analyzing the codebase for type errors...
--------------------------------------------------------------------------------
[2025-10-30T10:29:58.000Z] say
  SAY: Found 15 type errors across 8 files
--------------------------------------------------------------------------------
[2025-10-30T10:30:00.000Z] ask
  ASK: I found 15 type errors. Should I fix them all?
--------------------------------------------------------------------------------
```

## Step 2: Start the Orchestrator

Now let's start the orchestrator to automatically monitor and analyze:

```bash
./scripts/watch-and-orchestrate.sh
```

Or if you want manual control:

```bash
./scripts/watch-and-orchestrate.sh --manual
```

You'll see:

```
═══════════════════════════════════════════════════════════════
           CLINE ORCHESTRATOR + CLAUDE CODE
═══════════════════════════════════════════════════════════════

Mode:              auto
Check Interval:    3000ms
Output Directory:  /home/user/cline/.cline-orchestrator

Press Ctrl+C to stop

Starting orchestrator...
Orchestrator running (PID: 12345)
Monitoring for Cline activity...
```

## Step 3: Wait for Decisions

When Cline does something that needs attention, you'll see:

```
═══════════════════════════════════════════════════════════════
NEW DECISION DETECTED
═══════════════════════════════════════════════════════════════
Time:             Wed Oct 30 10:30:15 2025
Status:           waiting_for_input
Needs Action:     true
Recommendation:   Approve continuation
═══════════════════════════════════════════════════════════════

Suggested Response:
"Yes, please continue."

Sending to Claude Code for analysis...
─────────────────────────────────────────────────────────────
[Claude Code will output its analysis here]
─────────────────────────────────────────────────────────────
```

## Step 4: Act on the Decision

Based on Claude Code's analysis:

1. **If approved**: Copy the suggested response and paste it into Cline's chat
2. **If modified**: Use Claude Code's recommended response instead
3. **If rejected**: Provide your own response or stop Cline

## Example Workflow

### Scenario: Cline asks for permission

**Cline's message:**
```
I found 15 type errors. Should I fix them all?
```

**Orchestrator decision:**
```json
{
  "status": "waiting_for_input",
  "recommendation": "Approve continuation",
  "suggestedResponse": "Yes, please continue.",
  "shouldContinue": true,
  "confidence": "high"
}
```

**Claude Code analysis:**
```
Based on the context, Cline has identified type errors and is asking for
permission to fix them. This is a routine task that should be approved.

Recommendation: Approve with the suggested response.

Response to provide to Cline:
"Yes, please fix all 15 type errors. Let me know if you encounter any issues."
```

**Your action:**
1. Copy the response
2. Paste into Cline's chat
3. Cline continues working

## Common Scenarios

### ✅ Cline Waiting for Input

**Status**: `waiting_for_input`

**What to do**:
- Review the question in the orchestrator output
- Check Claude Code's suggested response
- Paste the response into Cline

### ❌ Cline Hit an Error

**Status**: `error`

**What to do**:
- Read the error in the recent messages
- Review Claude Code's diagnosis
- Provide guidance to Cline on how to fix it

### ⏸️ Cline Idle

**Status**: `idle`

**What to do**:
- Check if the task is actually complete
- If not, prompt Cline to continue: "Please continue with the next step."

### ✨ Cline Processing

**Status**: `processing`

**What to do**:
- Nothing! Let Cline work
- The orchestrator will alert you when intervention is needed

## Files Created

The orchestrator creates these files in `.cline-orchestrator/`:

```
.cline-orchestrator/
├── latest-decision.json        # Most recent decision (for scripts)
├── suggested-response.txt      # Ready-to-paste response
├── claude-prompt.md           # Detailed analysis prompt
└── decision-{timestamp}.json  # Historical decisions
```

## Tips

1. **Start in manual mode** until you trust the system:
   ```bash
   ./scripts/watch-and-orchestrate.sh --manual
   ```

2. **Review the prompt file** to see full context:
   ```bash
   cat .cline-orchestrator/claude-prompt.md
   ```

3. **Adjust check interval** if Cline is very active:
   ```bash
   ./scripts/watch-and-orchestrate.sh --interval=5000
   ```

4. **Keep orchestrator running** in a separate terminal while you work

5. **Check decision history** to see what happened:
   ```bash
   ls -lt .cline-orchestrator/decision-*.json | head -5
   ```

## Troubleshooting

### "No active task found"

- Make sure Cline is running with an active task in VS Code
- The task must have at least one message in the chat

### Orchestrator not detecting changes

- Cline might not have any new activity
- Try asking Cline a question to trigger a state change
- Check the interval (default 3 seconds might be too long/short)

### Claude Code command not found

If you see "Claude Code CLI not found", you need to either:

1. Install Claude Code CLI and ensure it's in your PATH
2. Use manual mode and copy/paste prompts yourself:
   ```bash
   cat .cline-orchestrator/claude-prompt.md
   ```

## Next Steps

Once you're comfortable with the basics:

1. Read the [full documentation](./ORCHESTRATION_README.md)
2. Customize the decision logic for your workflow
3. Set up automated response pasting (requires VS Code extension)
4. Integrate with other tools (Slack notifications, webhooks, etc.)

## Questions?

- Review recent decisions: `cat .cline-orchestrator/latest-decision.json`
- Check Cline's current state: `npx ts-node scripts/monitor-cline.ts`
- Read the detailed README: `cat scripts/ORCHESTRATION_README.md`

---

Happy orchestrating! 🤖
