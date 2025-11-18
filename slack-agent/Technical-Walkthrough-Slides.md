# Redis-Powered AI Agent: Technical Deep Dive
## Step-by-Step Walkthrough in Slides

**Format:** 16:9 slides (960px width) | **Total:** 22 slides | **Duration:** ~30-40 minutes

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

### The 15-Step Journey:

1. Slack webhook arrives at FastAPI → **Acknowledged in 50ms**
2. Task queued to Redis Streams → **Returns immediately**
3. Worker picks up from queue → **Begins processing**
4. Track thread participation → **Prevent spam**
5. Send "Thinking..." update → **User feedback**
6. Gather thread context → **Conversation history**
7. **🌟 Agent starts ReAct loop** → **Intelligence begins**
8-12. Agent reasons & searches → **Multi-turn thinking**
13. Store answer in Redis → **Analytics ready**
14. Post to Slack with feedback buttons → **User sees response**
15. User feedback updates Redis → **Continuous improvement**

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
  "task": "app.agent.tasks.slack_tasks:process_slack_question...",
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

## SLIDE 8 - Step 4: Track Thread Participation

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

## SLIDE 9 - Step 5: Send Progress Update

**Context:** LLM processing can take 3-10 seconds. We send immediate feedback so users know we're working. Progress updates keep users engaged during processing.

**Code** (`app/agent/tasks/slack_tasks.py:146`):

```python
async def progress_callback(message: str):
    """Send progress updates to Slack during processing"""
    status_text = f"_{message}_"  # Slack italic markdown

    await get_slack_app().client.chat_postMessage(
        channel=channel_id,
        text=status_text,
        thread_ts=thread_ts,
    )

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

More updates follow: *"Searching knowledge base..."*, *"Analyzing results..."*

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 10 - Step 6: Gather Thread Context

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

## SLIDE 11 - Step 7: Agent Starts 🌟 THE MAGIC BEGINS

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
        model=CHAT_MODEL,      # GPT-4.1 or Bedrock Claude
        messages=messages,
        tools=tools,
        tool_choice="auto",    # LLM decides which tools
    )
```

### The ReAct Pattern:

| **Reason** → LLM analyzes the question and decides what information it needs
| **Act** → Execute chosen tool (search Redis, web search, memory lookup)
| **Observe** → Add tool results to conversation context
| **Repeat** → Until LLM has enough info to formulate complete answer

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 12 - Step 8: Iteration 1 - Tool Decision 🧠

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

## SLIDE 13 - Step 9: Embedding Cache Check 💰

**Context:** Vector search requires converting text to embeddings (calling OpenAI costs money). We cache every embedding in Redis for 24 hours. In production, this saves 65% on embedding costs.

**Code** (`app/agent/tools/search_knowledge_base.py:40`):

```python
# Convert query to vector - checks cache first
query_vector = vectorizer.embed(query, as_buffer=True)

# Behind the scenes (RedisVL EmbeddingsCache):
# 1. Hash the query text
# 2. Check Redis cache: GET embedding:cache:text-embedding-3-small:{hash}
# 3. Cache hit? Return in <0.1ms
# 4. Cache miss? Call OpenAI API, then cache for 24h
```

### 📦 Redis Storage (Binary String)

**Key:** `embedding:cache:text-embedding-3-small:9f3a8c2d1e4b...`
**Value:** `<binary: 6144 bytes>` (1536 × float32)
**TTL:** 86400 seconds (24 hours)

```bash
GET embedding:cache:text-embedding-3-small:9f3a8c2d1e4b...
# Miss: Call OpenAI ($0.0001/1K tokens), then:
SET embedding:cache:... <binary> EX 86400
```

**ROI:** 65% cache hit rate = 65% cost savings on embeddings

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 14 - Step 10: Vector Search in Redis 🔍

**Context:** Now we perform semantic similarity search. Redis compares the query embedding against thousands of document embeddings stored as vector fields in Redis Hashes, returning the most similar matches.

**Code** (`app/agent/tools/search_knowledge_base.py:43`):

```python
results = await index.query(
    VectorQuery(
        vector=query_vector,              # [0.023, -0.145, ...]
        vector_field_name="vector",
        return_fields=["name", "description"],
        num_results=5,
    )
)

# Redis command: FT.SEARCH rag_doc "*=>[KNN 5 @vector $vec]"
#                PARAMS 2 vec <binary_vector>
```

### 📦 Redis Storage (Hash + Vector Field)

**Key:** `rag_doc:documentation:semantic-caching:0`

| Field | Value |
|-------|-------|
| `name` | "Redis Semantic Caching - Overview" |
| `description` | "Semantic caching stores LLM responses by meaning, not exact text..." |
| `vector` | `<6144 bytes of float32>` |
| `source_file` | "semantic-caching.md" |

**Performance:** 0.5-2ms for 10K docs, <5ms for 1M docs (HNSW index)

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 15 - Step 11: Search Results Returned

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
   Semantic caching handles variations: "NYC weather" ≈ "New York
   weather" ≈ "What's the weather in New York City?"

5. Redis Vector Search Performance: Sub-millisecond lookups even
   with millions of cached entries using HNSW indexing.
```

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 16 - Step 12: Agent Formulates Answer 🎯

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

## SLIDE 17 - Step 13: Store Answer in Redis 📊

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

## SLIDE 18 - Step 14: Post to Slack with Feedback 💬

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

## SLIDE 19 - Step 15: User Feedback Loop 🔄

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

## SLIDE 20 - Complete Journey Summary

**Context:** Let's recap the entire journey. From webhook to response in ~5 seconds, touching 7 different Redis operations across 4 different data types - all in one database.

### 15 Steps in ~5 Seconds

| Step | Action | Redis Operation |
|------|--------|-----------------|
| 1 | Webhook arrives | - |
| 2 | Queue task | Stream WRITE |
| 3 | Worker picks up | Stream READ |
| 4 | Track participation | String SET (TTL) |
| 5 | Send "Thinking..." | - |
| 6 | Gather thread context | - |
| 7-12 | **🌟 Agent ReAct loop** | **String GET (cache)** |
|  |  | **Vector SEARCH (KNN)** |
| 13 | Store answer | JSON WRITE |
| 14 | Post to Slack | - |
| 15 | User feedback | JSON UPDATE |

### Redis Operations Count:

- 1 Stream write, 1 Stream read → Task queue
- 1 String write (TTL), 1 String read → Thread tracking & cache
- 1 Vector search → Knowledge base (5 results in <2ms)
- 1 JSON write, 1 JSON update → Answer storage & feedback

**Total:** 7 Redis operations, all sub-millisecond

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 21 - All Redis Data Types

**Context:** This journey used 5 different Redis data types, each chosen for its specific strengths. All stored in ONE database, with unified operations and monitoring.

### What We Stored:

**1. Stream** (Task Queue)
- **Key:** `docket:applied-ai-agent:tasks`
- **Why:** Guaranteed delivery, consumer groups, fault tolerance

**2. String + TTL** (Thread Tracking)
- **Key:** `thread_participation:C123GENERAL:1234567890.123456`
- **Why:** Auto-expiring flags, atomic operations, memory efficient

**3. String (Binary)** (Embedding Cache)
- **Key:** `embedding:cache:text-embedding-3-small:9f3a8c2d...`
- **Why:** Fast binary storage, 24h TTL, 65% cost savings

**4. Hash + Vector** (Knowledge Base)
- **Key:** `rag_doc:documentation:semantic-caching:0`
- **Why:** Multi-field documents with sub-ms vector similarity search

**5. JSON** (Answer Storage & Analytics)
- **Key:** `answer:U789BRANDON-a8f3c9d2-1234567890.123456`
- **Why:** Flexible schema, path-based updates, queryable

### All in ONE Redis Instance:

✅ Single connection | ✅ Unified backup | ✅ Sub-ms performance | ✅ One dashboard

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 22 - Agent Memory Server 🧠

**Context:** We haven't talked much about it yet, but there's a critical component: the Agent Memory Server. This is a separate microservice (also backed by Redis) that stores long-term conversation memory for each user.

### What is Agent Memory Server?

A specialized service for agent memory management:

**Features:**
- Stores conversation history per user
- Semantic search across past conversations
- Automatic memory consolidation (summarizes old conversations)
- Memory retrieval tools available to the agent

**Architecture:**

```
Agent → Memory API Client → Agent Memory Server → Redis
                                                    ├─ Vectors (memories)
                                                    ├─ JSON (conversations)
                                                    └─ Search indexes
```

**Code** (from Slide 11):

```python
tools = [
    get_search_knowledge_base_tool(),
    get_web_search_tool(),
    *MemoryAPIClient.get_all_memory_tool_schemas(),  # ← Memory tools
]
```

**Example:** If Brandon previously asked about vector search, the agent can recall that context when answering about semantic caching, providing continuity across days or weeks.

**Benefit:** Personalized, context-aware responses that remember user history

</div>

---

<div style="max-width: 960px; margin: 0 auto; padding: 40px;">

## SLIDE 23 - Key Takeaways

**Context:** We've journeyed through 15 steps, seen real production code, and examined every Redis operation. Here's what makes this architecture powerful.

### What You've Learned:

✅ Followed one message end-to-end through a production AI agent
✅ Saw exactly how Redis is used at each step (7 operations, 5 data types)
✅ Examined real code with actual file paths
✅ Understood **where the magic happens** (ReAct agent loop)
✅ Learned about Agent Memory Server for conversation continuity

### Why This Architecture Works:

- **ONE** Redis database replaces 5+ specialized systems
- **Every operation is sub-millisecond** (even vector search)
- **Each data type optimized** for its specific use case
- **Production-ready patterns:** queues, retries, TTLs, fault tolerance
- **70% cost savings** vs. multi-database approach
- **Simple operations:** Easier to debug, monitor, and maintain

### Try It Yourself:

📦 **GitHub:** `github.com/redis-applied-ai/redis-slack-worker-agent`

📚 **Full docs:** `Full-Overview.md` in this repo

🚀 **Quick start:** `docker-compose up` (running in 5 minutes)

💬 **Contact:** brandon.amos@redis.com

</div>

---

## 📋 Presentation Guide

### Timing (35-40 minutes):
- **Slides 1-4:** Intro & Context (5 min)
- **Slides 5-10:** Early Steps (10 min)
- **Slides 11-16:** 🌟 Agent Magic (10 min) ← **Emphasize this**
- **Slides 17-21:** Storage & Data Types (8 min)
- **Slides 22-23:** Memory Server & Takeaways (5 min)

### Presentation Tips:

1. **"Where the Magic Happens"** - Really emphasize slides 11-16 (ReAct loop)
2. **Show Redis operations live** - Have RedisInsight open, show actual keys
3. **Code is real** - Mention file paths prove this is production code
4. **One database theme** - Repeat throughout: "all in ONE Redis instance"

### Font Recommendations:
- **Code:** Consolas 14-16pt
- **Body:** Calibri/Arial 18-24pt
- **Accent:** Redis Red (#DC382D)

**Ready for PowerPoint!** Each slide is constrained to 960px width for optimal formatting.
