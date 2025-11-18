# Redis-Powered AI Agent: Technical Deep Dive
## Step-by-Step Walkthrough in Slides

**Format:** 16:9 slides (960px width) | **Total:** 25 slides | **Duration:** ~35-45 minutes

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 1

<div align="center">

# Redis-Powered AI Agent
## Technical Deep Dive

### Following One Message Through The Entire System

<br/>

**Brandon Amos**
Redis Applied AI
November 18, 2024

<br/>

*"Let's see exactly how Redis powers every step"*

</div>

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 2 - What We're Building

**Context:** Before we dive into the code, let's understand what we've built and why Redis is the perfect foundation for AI agents.

### What We're Building: Haink

**A production Slack bot that:**

✅ Answers questions about Redis AI capabilities
✅ Searches a curated knowledge base (RAG)
✅ Remembers past conversations with each user
✅ Uses web search for current information
✅ Processes tasks asynchronously (no blocking)
✅ Tracks feedback for continuous improvement

### The Challenge

Most AI agents require multiple databases:
- **PostgreSQL** (documents) → Complex to maintain
- **Pinecone** (vectors) → High latency between systems
- **RabbitMQ** (queues) → Data consistency issues
- **Memcached** (cache) → Expensive ($170/month minimum)

### Our Approach

<div align="center">

## **ONE REDIS DATABASE**
*(Streams, Vectors, JSON, Strings)*

</div>

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 3 - Architecture Overview

**Context:** Our architecture separates concerns into three layers, all communicating through Redis as the single source of truth.

```
                            ┌─────────┐
                            │  Slack  │
                            └────┬────┘
                                 │ Webhook
                                 ▼
                        ┌────────────────┐
                        │  FastAPI API   │ ← Handles webhooks
                        └────────┬───────┘   Queues tasks (< 3s)
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────┐
│                   Redis (Single Database)                   │
│  Streams  |  Hashes+Vectors  |  JSON  |  Strings+TTL       │
│  (Queue)     (Knowledge)       (Docs)    (Cache/Flags)     │
└────────────────────────┬───────────────────────────────────┘
                         │
                         ▼
                ┌────────────────┐
                │ Docket Worker  │ ← Processes tasks
                └────────┬───────┘   Runs agent
                         │
                         ▼
                ┌────────────────┐
                │ Agent (ReAct)  │ ← 🌟 WHERE THE MAGIC HAPPENS
                │                │   Makes decisions
                │ Tools:         │   Searches Redis
                │ • Knowledge    │   Uses memory
                │ • Memory       │   Web search
                │ • Web Search   │
                └────────────────┘
```

**Today:** We'll follow ONE message through this entire system, step by step

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 4 - The Journey Begins

**Context:** Let's follow a real question from Brandon in the #general-questions channel. Watch how it flows through every component and see exactly what Redis stores along the way.

### Our Example Question:

```
┌─────────────────────────────────────────────────────┐
│  Slack - #general-questions                         │
│                                                     │
│  👤 Brandon (10:30:15 AM)                          │
│  @Haink Tell me about Redis for Semantic caching  │
└─────────────────────────────────────────────────────┘
```

### The Journey (14 Steps):

1. Slack webhook arrives → **Acknowledged in 50ms**
2. Task queued to Redis Streams → **Returns immediately**
3. Worker picks up task → **Begins processing**
4. **🔑 Orchestrator function coordinates everything**
5. Track thread participation → **Prevent spam**
6. Send "Thinking..." update → **User feedback**
7. Gather thread context → **Conversation history**
8. **🌟 Agent starts with system prompt** → **Intelligence begins**
9-11. Agent reasons & searches → **Multi-turn thinking**
12. Store answer in Redis → **Analytics ready**
13. Post to Slack with feedback → **User sees response**
14. User feedback updates Redis → **Continuous improvement**

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 5 - Step 1: Webhook Arrives

**Context:** Slack sends a webhook to our FastAPI server. We have 3 seconds to acknowledge or Slack will retry. Our strategy: acknowledge immediately, queue the work, return.

**What Happens:** Slack POST to `/slack/events`

```json
{
  "event": {
    "type": "app_mention",
    "user": "U789BRANDON",
    "text": "@Haink Tell me about Redis for Semantic caching",
    "channel": "C123GENERAL",
    "ts": "1234567890.123456",
    "thread_ts": null
  }
}
```

**Code** (`app/api/main.py:137`):

```python
async def handle_app_mentions(body, say, ack):
    await ack()  # MUST respond within 3 seconds!

    user = body["event"]["user"]         # "U789BRANDON"
    text = body["event"]["text"]         # "Tell me about..."
    channel = body["event"]["channel"]   # "C123GENERAL"
```

> **Critical:** Slack requires acknowledgment within 3 seconds or will retry
> **Solution:** Acknowledge immediately, queue work for async processing

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 6 - Step 2: Queue to Redis Streams

**Context:** Now that we've acknowledged Slack, we queue the actual work to Redis Streams. This decouples the API from the heavy processing and makes the system fault-tolerant.

**Code** (`app/api/main.py:126-134`):

```python
question_key = keys.question_key(user, text, message_ts)

async with Docket(name="applied-ai-agent", url=redis_url) as docket:
    await docket.add(process_slack_question_with_retry, key=question_key)(
        user_id=user,
        text=text,
        channel_id=channel,
        thread_ts=thread_ts
    )
```

### 📦 Redis Storage (Streams)

**Key:** `docket:applied-ai-agent:tasks`

```
1705315815000-0 {
  "task": "app.agent.tasks.slack_tasks:process_slack_question_with_retry",
  "key": "question-U789BRANDON-a8f3c9d2-1234567890.123456",
  "args": "{\"user_id\":\"U789BRANDON\",\"text\":\"Tell me...\"}",
  "retry_count": "0"
}
```

**Why Streams:** Guaranteed delivery, consumer groups, auto-redelivery

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 7 - Step 3: Worker Picks Up Task

**Context:** Our Docket worker continuously polls Redis Streams using consumer groups. When a task appears, it's immediately claimed by a worker. If the worker crashes, another worker will pick it up after timeout.

**Code** (`app/worker/worker.py:107`):

```python
await Worker.run(
    docket_name="applied-ai-agent",
    url=redis_url,
    concurrency=1,
    redelivery_timeout=timedelta(seconds=60),
    tasks=["app.worker.task_registration:all_tasks"],
)
```

### How it Works:

1. Worker executes: `XREADGROUP GROUP workers consumer1 BLOCK 5000 STREAMS docket:applied-ai-agent:tasks`
2. Redis returns the queued task entry
3. Worker deserializes and calls: `process_slack_question_with_retry()`
4. If worker crashes, task redelivered after 60s to another worker

**Benefits:** No lost messages. Horizontal scaling. Fault tolerance.

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 8 - Step 4: The Orchestrator 🔑

**Context:** This is THE key function that coordinates the entire workflow. It handles retries, calls the agent, posts to Slack, and handles errors gracefully.

**Code** (`app/agent/tasks/slack_tasks.py:334`):

```python
async def process_slack_question_with_retry(
    user_id: str,
    text: str,
    channel_id: str,
    thread_ts: Optional[str] = None,
    retry: Retry = Retry(attempts=3, delay=timedelta(seconds=2)),
) -> None:
    """Main orchestrator: coordinates all steps with retry logic"""
    try:
        # Generate the RAG response (calls agent)
        rag_response = await generate_rag_response(
            user_id, text, thread_ts, channel_id
        )

        # Post response to Slack with feedback buttons
        await post_slack_message(
            user_id, text, thread_ts, rag_response, channel_id
        )

    except Exception as e:
        if retry.attempt >= retry.attempts:
            await post_error_message(...)  # Final failure
        raise e  # Trigger retry
```

**What it does:** Calls `generate_rag_response` → Posts to Slack → Handles errors

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 9 - Step 5: Track Thread Participation

**Context:** Before we engage, we check if we've already participated in this thread. This prevents the bot from monopolizing conversations or responding to every reply.

**Code** (`app/agent/tasks/slack_tasks.py:386`):

```python
async def track_thread_participation(channel_id, thread_ts):
    client = get_redis_client()
    participation_key = keys.thread_participation_key(channel_id, thread_ts)

    await client.set(participation_key, "1", ex=3600)  # 1 hour TTL
```

### 📦 Redis Storage (String + TTL)

**Key:** `thread_participation:C123GENERAL:1234567890.123456`
**Value:** `"1"`
**TTL:** 3600 seconds (auto-expires)

```bash
SET thread_participation:C123GENERAL:1234567890.123456 "1" EX 3600
```

**Why This Matters:**
- Prevents bot spam in active threads
- Auto-cleanup after 1 hour (Redis handles it)
- Atomic check-and-set operation

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 10 - Step 6: Send Progress Update

**Context:** LLM processing can take 3-10 seconds. We send immediate feedback so users know we're working. Progress updates keep users engaged during processing.

**Code** (`app/agent/tasks/slack_tasks.py:129-146`):

```python
async def generate_rag_response(
    user_id, text, thread_ts, channel_id
):
    # Create progress callback
    async def progress_callback(message: str):
        status_text = f"_{message}_"  # Slack italic
        await get_slack_app().client.chat_postMessage(
            channel=channel_id,
            text=status_text,
            thread_ts=thread_ts,
        )

    # Send immediate acknowledgment BEFORE heavy operations
    await progress_callback("Thinking...")
```

### What User Sees:

```
┌─────────────────────────────────────────────────────┐
│  👤 Brandon (10:30:15 AM)                          │
│  @Haink Tell me about Redis for Semantic caching  │
│                                                     │
│  🤖 Haink (10:30:15 AM)                            │
│  Thinking...                                       │
└─────────────────────────────────────────────────────┘
```

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 11 - Step 7: Gather Thread Context

**Context:** If this is part of a conversation thread, we need the full history. This allows the agent to understand references like "this", "that approach", or "what you mentioned earlier".

**Code** (`app/agent/tasks/slack_tasks.py:36`):

```python
async def get_thread_context(channel_id: str, thread_ts: str):
    result = await slack_app.client.conversations_replies(
        channel=channel_id, ts=thread_ts, limit=50
    )

    thread_context = []
    for message in result["messages"]:
        user_id = message.get("user", "unknown")
        text = message["text"]

        user_info = await slack_app.client.users_info(user=user_id)
        username = user_info["user"]["real_name"]

        thread_context.append({"user": username, "text": text})

    return thread_context
```

**Why This Matters:**
- Enables multi-turn conversations
- Agent understands context and references
- Better answers from conversation history

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 12 - Step 8: The System Prompt 📜

**Context:** Before the agent starts reasoning, it receives a comprehensive system prompt (235 lines!) that defines its personality, tools, and behavior. Here are the key parts:

```python
SYSTEM_PROMPT = """
You are Haink, a polite and knowledgeable member of the Applied AI
team at Redis, Inc.

## Available Tools
- search_knowledge_base: Search Redis AI knowledge base
- web_search: Search the web for current information
- search_memory: Find info from previous conversations
- get_working_memory: Retrieve current conversation context
- add_memory_to_working_memory: Store long-term user memories
- update_working_memory_data: Update memory data

## When to Use Tools
Use search_knowledge_base for:
- Redis features, implementations, best practices
- RedisVL, Agent Memory Server questions

Use web_search for:
- Questions with recency ("latest", "recent", "new")
- URLs, links, external documentation
- Competitor comparisons or market analysis

...
(235 lines total)
```

**Key Insight:** This prompt teaches the LLM HOW to be an agent

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 13 - Step 9: Agent Starts 🌟 THE MAGIC BEGINS

**Context:** Here's where the intelligence happens. The agent uses the ReAct (Reason-Act-Observe) pattern: it thinks about what tools it needs, executes them, observes results, and repeats until it has enough information to answer.

**Code** (`app/agent/core.py:346-362`):

```python
max_iterations = 25
tools = [
    get_search_knowledge_base_tool(),     # Search Redis vectors
    get_web_search_tool(),                # Tavily web search
    *MemoryAPIClient.get_all_memory_tool_schemas(),  # Agent Memory
]

messages = [
    {"role": "system", "content": SYSTEM_PROMPT},  # 235 lines!
    {"role": "user", "content": f"User: {text}"}
]

while iteration < max_iterations:
    response = client.chat.completions.create(
        model=CHAT_MODEL,      # GPT-4 or Bedrock Claude
        messages=messages,
        tools=tools,
        tool_choice="auto",    # LLM decides which tools
    )
```

### The ReAct Pattern:

**Reason** → LLM analyzes the question and decides what information it needs
**Act** → Execute chosen tool (search Redis, web search, memory lookup)
**Observe** → Add tool results to conversation context
**Repeat** → Until LLM has enough info to formulate complete answer

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 14 - Step 10: Iteration 1 - Tool Decision 🧠

**Context:** The LLM receives Brandon's question about semantic caching. It reasons that it should search the internal knowledge base first before trying web search or other tools.

### LLM's Internal Reasoning:

**Input:** *"Tell me about Redis for Semantic caching"*

**Thinks:** *"This is asking about a specific Redis feature. I should search the internal knowledge base for authoritative information about semantic caching capabilities."*

**Decision:** Call `search_knowledge_base` tool

### Tool Call (JSON Response from LLM):

```json
{
  "tool_calls": [{
    "id": "call_abc123",
    "type": "function",
    "function": {
      "name": "search_knowledge_base",
      "arguments": "{\"query\": \"Redis semantic caching\"}"
    }
  }]
}
```

**Code executes** (`app/agent/core.py:391`):

```python
if tool_call.function.name == "search_knowledge_base":
    await progress_callback("Searching knowledge base...")
    args = json.loads(tool_call.function.arguments)
    results = await search_knowledge_base(index, vectorizer,
                                          args.get("query"))
```

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 15 - Step 11: Vector Search in Redis 🔍

**Context:** The search_knowledge_base tool converts the query to an embedding (via OpenAI API, cached in Redis for cost savings), then performs semantic similarity search against the knowledge base stored as vectors in Redis Hashes.

**Code** (`app/agent/tools/search_knowledge_base.py:40-43`):

```python
# Convert query to embedding (checks cache, saves 65% on costs)
query_vector = vectorizer.embed(query, as_buffer=True)

# Search Redis for similar documents
results = await index.query(
    VectorQuery(
        vector=query_vector,              # [0.023, -0.145, ...]
        vector_field_name="vector",
        return_fields=["name", "description"],
        num_results=5,
    )
)

# Behind the scenes: FT.SEARCH rag_doc "*=>[KNN 5 @vector $vec]"
```

### 📦 Redis Storage (Hash + Vector Field)

**Key:** `rag_doc:documentation:semantic-caching:0`

| Field | Value |
|-------|-------|
| `name` | "Redis Semantic Caching - Overview" |
| `description` | "Semantic caching stores LLM responses by meaning..." |
| `vector` | `<6144 bytes of float32>` |

**Performance:** 0.5-2ms for 10K docs, <5ms for 1M docs (HNSW)

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 16 - Step 12: Search Results Returned

**Context:** Redis returns the top 5 most semantically similar documents. These are added to the conversation as a tool result, which the LLM will use to formulate its answer.

### Search Performance:

- **Query:** "Redis semantic caching"
- **Time:** 1.2ms (10K document corpus)
- **Algorithm:** Cosine similarity via HNSW index
- **Results:** Top 5 matches

### Results Returned to Agent:

```
Search results for 'Redis semantic caching':

1. Redis Semantic Caching - Overview: Semantic caching uses vector
   similarity to match queries by meaning, not exact text. Cache
   "What's the weather?" and match "How's the weather today?"

2. Cost Savings with Semantic Cache: Production deployments show
   40-60% cache hit rates, saving $1000s on LLM API costs monthly.

3. Implementation Patterns: Store query embeddings + LLM responses
   in Redis. On new query, find similar cached query (>0.95
   similarity), return cached response instantly.

4. Semantic vs Exact Caching: Exact caching fails on paraphrases.
   Semantic caching handles variations.

5. Redis Vector Search Performance: Sub-millisecond lookups even
   with millions of cached entries using HNSW indexing.
```

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 17 - Step 13: Agent Formulates Answer 🎯

**Context:** The agent now has comprehensive information from the knowledge base. It reviews the search results and decides it has enough context to provide a complete answer. No more tool calls needed.

### Conversation State:

```python
messages = [
    {"role": "system", "content": SYSTEM_PROMPT},
    {"role": "user", "content": "Tell me about Redis for Semantic caching"},
    {"role": "assistant", "tool_calls": [...]},  # search_knowledge_base
    {"role": "tool", "content": "Search results: 1. Redis Semantic..."}
]
```

### LLM's Final Reasoning:

**Thinks:** *"I have detailed information about semantic caching: what it is, why it's valuable (cost savings), how it works (vector similarity), and performance characteristics. I can now formulate a comprehensive answer in Slack-friendly markdown."*

**Decision:** Return final response (no more tool calls)

### Response Format:

```json
{
  "response": "Redis semantic caching matches queries by meaning...",
  "use_org_search": false
}
```

> System prompt instructs LLM to return JSON with these exact keys

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 18 - Step 14: Store Answer in Redis 📊

**Context:** Before posting to Slack, we store the complete Q&A pair in Redis as a JSON document. This powers our analytics, feedback tracking, and future improvements to the knowledge base.

**Code** (`app/agent/tasks/slack_tasks.py:225`):

```python
answer_key = keys.answer_key(user_id, text, thread_ts)
answer_data = {
    "id": str(ULID()),
    "user_id": user_id,
    "question": text,
    "answer": response,
    "accepted": "",              # Updated when user clicks feedback
    "created_at": datetime.now(timezone.utc).timestamp(),
    "updated_at": datetime.now(timezone.utc).timestamp(),
    "thread_ts": thread_ts or "",
    "channel_id": channel_id or "",
}

async with get_answer_index() as answer_index:
    await answer_index.load(data=[answer_data], id_field="id",
                            keys=[answer_key])
```

### 📦 Redis Storage (JSON Document)

**Key:** `answer:U789BRANDON-a8f3c9d2-1234567890.123456`

```json
{
  "id": "01HN3KQZX9M8V7B6N5C4T3R2P1",
  "user_id": "U789BRANDON",
  "question": "Tell me about Redis for Semantic caching",
  "answer": "Redis semantic caching matches queries by meaning...",
  "accepted": "",
  "created_at": 1705315815.123
}
```

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 19 - Step 15: Post to Slack with Feedback 💬

**Context:** Finally, we post the answer back to Slack with interactive feedback buttons. This completes the request-response cycle (~5 seconds total) and enables continuous improvement through user feedback.

**Code** (`app/agent/tasks/slack_tasks.py:171`):

```python
blocks = [
    {"type": "markdown", "text": response},
    {
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "👍 Helpful"},
                "value": f"thumbs_up:{answer_key}",
                "action_id": "feedback_thumbs_up",
            },
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "👎 Not Helpful"},
                "value": f"thumbs_down:{answer_key}",
            }
        ]
    }
]
```

### What Brandon Sees:

```
┌───────────────────────────────────────────────────────┐
│ 🤖 Haink (10:30:20 AM)                               │
│                                                       │
│ Redis semantic caching matches queries by meaning,   │
│ not exact text. Cache "weather in NYC" and match     │
│ "New York City weather forecast"...                  │
│                                                       │
│ [👍 Helpful]  [👎 Not Helpful]                      │
└───────────────────────────────────────────────────────┘
```

**Total Time:** ~5 seconds (mostly LLM inference)

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 20 - Step 16: User Feedback Loop 🔄

**Context:** When Brandon clicks a feedback button, we update the stored answer in Redis using JSON path operations. This data trains future improvements and helps us identify knowledge gaps.

**User Action:** Brandon clicks 👍 Helpful

**Code** (`app/api/main.py:248`):

```python
async def handle_feedback_action(ack, body, logger):
    await ack()

    value = action.get("value")  # "thumbs_up:answer:U789BRANDON..."
    accepted = value.startswith("thumbs_up")
    answer_key = value.split(":", 1)[1]

    # Queue as background task
    async with Docket(url=get_redis_url()) as docket:
        await docket.add(update_answer_feedback, key=feedback_key)(
            answer_key=answer_key, accepted=accepted
        )
```

**Update Handler** (`app/agent/tasks/slack_tasks.py:250`):

```python
async def update_answer_feedback(answer_key: str, accepted: bool):
    await redis_client.json().set(answer_key, "$.accepted", "true")
    await redis_client.json().set(answer_key, "$.updated_at", timestamp)
```

### 📦 Redis JSON Path Update

**Key:** `answer:U789BRANDON-a8f3c9d2-1234567890.123456`

**Updates:**
- `$.accepted` → `"true"`
- `$.updated_at` → `1705315820.456`

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 21 - Alternative Flow: Web Search 🌐

**Context:** Not all questions can be answered from our knowledge base. When Brandon asks about recent news or external topics, the agent uses web search instead.

### Example Question:

```
👤 Brandon: "What's new with OpenAI's latest model release?"
```

### Agent's Reasoning:

**Thinks:** *"This has recency indicators ('latest') and is asking about external news. I should use web_search, not search_knowledge_base."*

**Tool Call:**

```json
{
  "tool_calls": [{
    "function": {
      "name": "web_search",
      "arguments": "{\"query\": \"OpenAI latest model release news\"}"
    }
  }]
}
```

**Code** (`app/agent/tools/web_search.py`):

```python
# Calls Tavily API for web search
results = await tavily_client.search(
    query=query,
    max_results=5,
    search_depth="advanced"
)

# Returns: Title, URL, snippet for top 5 results
```

**Result:** Agent gets current web results, formulates answer with citations

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 22 - Alternative Flow: Memory Recall 🧠

**Context:** The Agent Memory Server stores long-term conversation history. When Brandon asks a follow-up question, the agent can recall previous context from days or weeks ago.

### Example Conversation:

**Week 1:**
```
👤 Brandon: "I'm building a recommendation engine"
🤖 Haink: [Answers about vector similarity search]
```

**Week 2 (Same user, new thread):**
```
👤 Brandon: "What caching strategy should I use for my project?"
```

### Agent Uses Memory:

**Tool Call:**

```json
{
  "tool_calls": [{
    "function": {
      "name": "search_memory",
      "arguments": "{\"user_id\": \"U789BRANDON\",
                     \"query\": \"user projects context\"}"
    }
  }]
}
```

**Memory Server Returns:**

```
Found memory: "Brandon is building a recommendation engine
using vector similarity. Asked about Redis vector search on 11/11."
```

**Agent's Response:** *"For your recommendation engine project, semantic caching would be perfect since you're already using vector similarity..."*

**Benefit:** Personalized, context-aware answers across conversations

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 23 - Complete Journey Summary

**Context:** Let's recap the entire journey. From webhook to response in ~5 seconds, touching 7 different Redis operations across 5 different data types - all in one database.

### 14 Main Steps in ~5 Seconds

| Step | Action | Redis Operation |
|------|--------|-----------------|
| 1 | Webhook arrives | - |
| 2 | Queue task | Stream WRITE |
| 3 | Worker picks up | Stream READ |
| 4 | Orchestrator starts | - |
| 5 | Track participation | String SET (TTL) |
| 6 | Send "Thinking..." | - |
| 7 | Gather thread context | - |
| 8-11 | **🌟 Agent ReAct loop** | **Vector SEARCH (KNN)** |
|  |  | **String GET (embed cache)** |
| 12 | Store answer | JSON WRITE |
| 13 | Post to Slack | - |
| 14 | User feedback | JSON UPDATE |

### Redis Operations Count:

- 1 Stream write, 1 Stream read → Task queue
- 1 String write (TTL), 1 String read → Thread tracking & embed cache
- 1 Vector search → Knowledge base (5 results in <2ms)
- 1 JSON write, 1 JSON update → Answer storage & feedback

**Total:** 7 Redis operations, all sub-millisecond

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 24 - All Redis Data Types

**Context:** This journey used 5 different Redis data types, each chosen for its specific strengths. All stored in ONE database, with unified operations and monitoring.

### What We Stored:

**1. Stream** (Task Queue)
- **Key:** `docket:applied-ai-agent:tasks`
- **Why:** Guaranteed delivery, consumer groups, fault tolerance

**2. String + TTL** (Thread Tracking & Embed Cache)
- **Keys:** `thread_participation:...`, `embedding:cache:...`
- **Why:** Auto-expiring flags, fast binary storage, cost savings

**3. Hash + Vector** (Knowledge Base)
- **Key:** `rag_doc:documentation:semantic-caching:0`
- **Why:** Multi-field documents with sub-ms vector similarity search

**4. JSON** (Answer Storage & Analytics)
- **Key:** `answer:U789BRANDON-a8f3c9d2-1234567890.123456`
- **Why:** Flexible schema, path-based updates, queryable

**5. Agent Memory** (Conversation History)
- Stored in separate Agent Memory Server (also Redis-backed)
- Vectors for semantic search + JSON for conversations

### All in ONE Redis Instance:

✅ Single connection | ✅ Unified backup | ✅ Sub-ms performance | ✅ One dashboard

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 25 - Key Takeaways

**Context:** We've journeyed through 14 steps, seen real production code, examined every Redis operation, and explored alternative flows. Here's what makes this architecture powerful.

### What You've Learned:

✅ Followed one message end-to-end through a production AI agent
✅ Saw the **key orchestrator function** that coordinates everything
✅ Examined the **system prompt** that teaches the LLM how to be an agent
✅ Understood **where the magic happens** (ReAct agent loop)
✅ Explored alternative flows (web search, memory recall)
✅ Saw exactly how Redis is used (7 operations, 5 data types)

### Why This Architecture Works:

- **ONE** Redis database replaces 5+ specialized systems
- **Key orchestrator** handles retries, errors, and coordination
- **Smart tool selection** via system prompt engineering
- **Every operation is sub-millisecond** (even vector search)
- **Production-ready patterns:** queues, retries, TTLs, fault tolerance
- **70% cost savings** vs. multi-database approach

### Try It Yourself:

📦 **GitHub:** `github.com/redis-applied-ai/redis-slack-worker-agent`

📚 **Full docs:** `Full-Overview.md` in this repo

🚀 **Quick start:** `docker-compose up` (running in 5 minutes)

💬 **Contact:** brandon.amos@redis.com

</div>

---

## 📋 Presentation Guide

### Timing (40-45 minutes):
- **Slides 1-4:** Intro & Context (5 min)
- **Slides 5-8:** Early Steps & Orchestrator (10 min) ← **Key function**
- **Slides 9-13:** System Prompt & Agent Start (8 min)
- **Slides 14-17:** 🌟 Agent Magic - ReAct Loop (10 min) ← **Emphasize this**
- **Slides 18-22:** Storage & Alternative Flows (8 min)
- **Slides 23-25:** Summary & Takeaways (5 min)

### Presentation Tips:

1. **Emphasize the orchestrator** - Slide 8 shows how everything connects
2. **Show the system prompt** - Slide 12 is unique, most people don't see this
3. **"Where the Magic Happens"** - Really emphasize slides 13-17 (ReAct loop)
4. **Alternative flows** - Slides 21-22 show the agent's flexibility
5. **Show Redis operations live** - Have RedisInsight open
6. **One database theme** - Repeat: "all in ONE Redis instance"

### Font Recommendations:
- **Code:** Consolas 14-16pt
- **Body:** Calibri/Arial 18-24pt
- **Accent:** Redis Red (#DC382D)

**Ready for PowerPoint!** Each slide constrained to 960px width.
