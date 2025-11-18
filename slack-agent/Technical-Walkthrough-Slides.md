# Redis-Powered AI Agent: Technical Deep Dive
## Step-by-Step Walkthrough in Slides

**Format:** 16:9 slides | **Total:** 22 slides | **Duration:** ~30-40 minutes
**Style:** Deep technical walkthrough following one message through the entire system

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 1 - TITLE
═══════════════════════════════════════════════════════════════════════════════════════════════════




                        Redis-Powered AI Agent: Technical Deep Dive

                              Following One Message Through
                                  The Entire System




                                      [Redis Logo]




                                    Brandon Amos
                                  Redis Applied AI
                                  November 18, 2024


                        "Let's see exactly how Redis powers every step"




═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 2 - WHAT WE'RE BUILDING
═══════════════════════════════════════════════════════════════════════════════════════════════════

                              What We're Building: Haink


    A production Slack bot that:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ✓ Answers questions about Redis AI capabilities
    ✓ Searches a curated knowledge base (RAG)
    ✓ Remembers past conversations with each user
    ✓ Uses web search for current information
    ✓ Processes tasks asynchronously (no blocking)
    ✓ Tracks feedback for continuous improvement


    The Challenge:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Most AI agents require:
    • PostgreSQL (documents)      →  Complex to maintain
    • Pinecone (vectors)          →  High latency between systems
    • RabbitMQ (queues)           →  Data consistency issues
    • Memcached (cache)           →  Expensive ($170/month minimum)
    • + Session store, rate limiter...


    Our Approach:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                              ONE REDIS DATABASE
                         (Streams, Vectors, JSON, Strings)


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 3 - ARCHITECTURE OVERVIEW
═══════════════════════════════════════════════════════════════════════════════════════════════════

                              System Architecture


                                    ┌─────────┐
                                    │  Slack  │
                                    └────┬────┘
                                         │ Webhook
                                         ▼
                                ┌────────────────┐
                                │  FastAPI API   │ ← Handles webhooks
                                └────────┬───────┘   Queues tasks
                                         │           Returns in <3s
                                         ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │                        Redis (Single Database)                      │
    │                                                                     │
    │  Streams      Hashes       JSON        Strings     +more           │
    │  (Queues)     (Vectors)    (Docs)      (Cache)                     │
    └────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │ Docket Worker  │ ← Processes tasks
                        └────────┬───────┘   Runs agent
                                 │           Calls tools
                                 ▼
                        ┌────────────────┐
                        │ Agent (ReAct)  │ ← Makes decisions
                        │                │   Searches Redis
                        │ • Knowledge    │   Uses memory
                        │ • Memory       │   Web search
                        │ • Web Search   │
                        └────────────────┘


    Today: We'll follow ONE message through this entire system, step by step


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 4 - THE JOURNEY BEGINS
═══════════════════════════════════════════════════════════════════════════════════════════════════

                            The Journey Begins


    Our Example Question:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ┌─────────────────────────────────────────────────────┐
    │  Slack - #engineering channel                       │
    │                                                     │
    │  👤 Sarah (10:30:15 AM)                            │
    │  @Haink what's Redis vector search?                │
    │                                                     │
    └─────────────────────────────────────────────────────┘


    What happens next:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    1. Slack sends webhook to our FastAPI server
    2. API acknowledges (< 50ms) and queues task to Redis
    3. Worker picks up task from Redis queue
    4. Agent searches knowledge base (stored in Redis)
    5. Agent formulates response
    6. Response posted back to Slack
    7. User feedback tracked in Redis


    Let's dive into each step and see the Redis storage...


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 5 - STEP 1: WEBHOOK ARRIVES
═══════════════════════════════════════════════════════════════════════════════════════════════════

                      Step 1: Slack Webhook Arrives at FastAPI


    What Happens:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Slack sends HTTP POST to: /slack/events

    Payload:
    {
      "event": {
        "type": "app_mention",
        "user": "U12345ABC",                     ← Sarah's user ID
        "text": "@Haink what's Redis vector search?",
        "channel": "C789XYZ",                    ← #engineering channel
        "ts": "1234567890.123456",               ← Message timestamp
        "thread_ts": null                        ← Not in a thread
      }
    }


    Code (app/api/main.py:137):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async def handle_app_mentions(body, say, ack):
        await ack()  # MUST respond within 3 seconds!

        user = body["event"]["user"]           # "U12345ABC"
        text = body["event"]["text"]           # "what's Redis vector search?"
        channel = body["event"]["channel"]     # "C789XYZ"
        thread_ts = body["event"].get("thread_ts")


    Critical: Slack requires acknowledgment within 3 seconds or will retry
    Solution: Acknowledge immediately, then queue work for background processing


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 6 - STEP 2: QUEUE TO REDIS
═══════════════════════════════════════════════════════════════════════════════════════════════════

                    Step 2: Queue Task to Redis Streams


    Code (app/api/main.py:126-134):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    question_key = keys.question_key(user, text, message_ts)

    async with Docket(name="applied-ai-agent", url=redis_url) as docket:
        await docket.add(process_slack_question_with_retry, key=question_key)(
            user_id=user,
            text=text,
            channel_id=channel,
            thread_ts=thread_ts
        )

    # API returns immediately - work happens in background


    📦 Redis Storage (Redis Streams):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Key:    docket:applied-ai-agent:tasks
    Type:   Stream

    Value (Stream Entry):
    1705315815000-0 {
      "task": "app.agent.tasks.slack_tasks:process_slack_question_with_retry",
      "key": "question-U12345ABC-a8f3c9d2-1234567890.123456",
      "args": "{\"user_id\":\"U12345ABC\",\"text\":\"what's Redis...\"}",
      "retry_count": "0"
    }

    Why Streams: Guaranteed delivery, ordered processing, consumer groups,
                 automatic redelivery if worker crashes


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 7 - STEP 3: WORKER PICKS UP
═══════════════════════════════════════════════════════════════════════════════════════════════════

                    Step 3: Worker Picks Up Task from Queue


    Code (app/worker/worker.py:107):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    await Worker.run(
        docket_name="applied-ai-agent",
        url=redis_url,
        concurrency=1,
        redelivery_timeout=timedelta(seconds=60),
        tasks=["app.worker.task_registration:all_tasks"],
    )

    # Worker continuously polls Redis Streams using XREADGROUP
    # When task found, executes process_slack_question_with_retry()


    How it Works:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    1. Worker issues: XREADGROUP GROUP workers consumer1
                      BLOCK 5000 STREAMS docket:applied-ai-agent:tasks

    2. Redis returns task entry

    3. Worker looks up function: process_slack_question_with_retry

    4. Worker executes with args: user_id, text, channel_id, thread_ts

    5. If execution fails, task redelivered after timeout


    Benefits: Worker crash? Another worker picks it up. No lost messages.


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 8 - STEP 4: TRACK THREAD PARTICIPATION
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 4: Track Thread Participation (Prevent Over-Engagement)


    Code (app/agent/tasks/slack_tasks.py:386):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async def track_thread_participation(channel_id, thread_ts):
        client = get_redis_client()
        participation_key = keys.thread_participation_key(channel_id, thread_ts)

        # Mark thread as participated
        await client.set(participation_key, "1", ex=3600)  # 1 hour TTL


    📦 Redis Storage (String with TTL):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Key:    thread_participation:C789XYZ:1234567890.123456
    Value:  "1"
    TTL:    3600 seconds (1 hour)

    Redis Command:
    SET thread_participation:C789XYZ:1234567890.123456 "1" EX 3600


    Why This Matters:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    • Prevents bot from responding to every message in a thread
    • Key auto-expires after 1 hour (Redis handles cleanup)
    • Simple flag check before engaging again
    • Atomic operation - no race conditions


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 9 - STEP 5: SEND PROGRESS UPDATE
═══════════════════════════════════════════════════════════════════════════════════════════════════

                    Step 5: Send Progress Update to User


    Code (app/agent/tasks/slack_tasks.py:146):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async def progress_callback(message: str):
        """Send progress status updates to Slack"""
        status_text = f"_{message}_"  # Italic in Slack markdown

        await get_slack_app().client.chat_postMessage(
            channel=channel_id,
            text=status_text,
            blocks=[{"type": "markdown", "text": status_text}],
            thread_ts=thread_ts,
        )

    # First update sent immediately
    await progress_callback("Thinking...")


    What User Sees in Slack:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ┌─────────────────────────────────────────────────────┐
    │  👤 Sarah (10:30:15 AM)                            │
    │  @Haink what's Redis vector search?                │
    │                                                     │
    │  🤖 Haink (10:30:15 AM)                            │
    │  Thinking...                                       │
    └─────────────────────────────────────────────────────┘


    Why: Gives immediate feedback that the bot is working
         Progress updates will follow: "Searching knowledge base..."
                                       "Analyzing results..."


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 10 - STEP 6: GATHER THREAD CONTEXT
═══════════════════════════════════════════════════════════════════════════════════════════════════

                    Step 6: Gather Thread Context from Slack


    Code (app/agent/tasks/slack_tasks.py:36):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async def get_thread_context(channel_id: str, thread_ts: str):
        # Get conversation replies (up to 50 messages)
        result = await slack_app.client.conversations_replies(
            channel=channel_id,
            ts=thread_ts,
            limit=50,
        )

        thread_context = []
        for message in result["messages"]:
            user_id = message.get("user", "unknown")
            text = message["text"]

            # Get username for better context
            user_info = await slack_app.client.users_info(user=user_id)
            username = user_info["user"]["real_name"]

            thread_context.append({"user": username, "text": text})

        return thread_context


    Why This Matters:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    • Agent gets full conversation history
    • Can reference previous questions/answers
    • Provides continuity in multi-turn conversations
    • Helps agent understand context ("this" refers to what?)


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 11 - STEP 7: AGENT STARTS (REACT LOOP)
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 7: Agent Starts - The ReAct Loop Begins


    Code (app/agent/core.py:346-362):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    max_iterations = 25
    tools = [
        get_search_knowledge_base_tool(),    # Search Redis vectors
        get_web_search_tool(),               # Search Tavily API
        *MemoryAPIClient.get_all_memory_tool_schemas(),  # Search Redis memories
    ]

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},  # 235 lines of instructions!
        {"role": "user", "content": "User question: what's Redis vector search?"}
    ]

    while iteration < max_iterations:
        response = client.chat.completions.create(
            model=CHAT_MODEL,      # gpt-4.1 or Bedrock Claude
            messages=messages,
            tools=tools,
            tool_choice="auto",    # LLM decides which tools to use
        )


    The ReAct Pattern:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Reason  → LLM analyzes question, decides what tools are needed
    Act     → Execute tool (search Redis, call API)
    Observe → Add tool results back to conversation
    Repeat  → Until LLM has enough information to answer


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 12 - STEP 8: ITERATION 1 - TOOL DECISION
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 8: Iteration 1 - LLM Decides to Search


    LLM's Reasoning:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Input:  "User question: what's Redis vector search?"

    Thinks: "I need specific information about Redis vector search capabilities
             from the internal knowledge base."

    Decision: Use search_knowledge_base tool


    Tool Call Response from LLM:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    {
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "search_knowledge_base",
          "arguments": "{\"query\": \"Redis vector search capabilities\"}"
        }
      }]
    }


    Code (app/agent/core.py:391):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    if tool_call.function.name == "search_knowledge_base":
        await progress_callback("Searching knowledge base...")

        args = json.loads(tool_call.function.arguments)
        search_query = args.get("query", "")

        search_results = await search_knowledge_base(index, vectorizer, search_query)


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 13 - STEP 9: EMBEDDING CACHE CHECK
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 9: Check Embedding Cache (Cost Optimization)


    Code (app/agent/tools/search_knowledge_base.py:40):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    # Convert query to vector embedding
    query_vector = vectorizer.embed(query, as_buffer=True)

    # Vectorizer checks Redis cache first (via RedisVL EmbeddingsCache)
    # If cached: return immediately (< 0.1ms)
    # If not cached: call OpenAI API, then cache result


    📦 Redis Storage (Binary String with TTL):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Key:    embedding:cache:text-embedding-3-small:5a8f3c9d2e1b4f6a7c8d9e0f1a2b3c4d
            (Hash of: "Redis vector search capabilities")

    Value:  <binary blob: 6144 bytes>
            (1536 float32 values = 1536 × 4 bytes)

    TTL:    86400 seconds (24 hours)

    Redis Commands:
    GET embedding:cache:text-embedding-3-small:5a8f3c9d2e1b4f6a7c8d9e0f1a2b3c4d
    # If miss: Call OpenAI, then:
    SET embedding:cache:... <binary> EX 86400


    Cost Savings:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    • OpenAI embedding API: $0.0001 per 1K tokens
    • Cache hit rate: ~65% in production
    • Result: 65% cost savings on embeddings


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 14 - STEP 10: VECTOR SEARCH IN REDIS
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 10: Vector Similarity Search in Redis


    Code (app/agent/tools/search_knowledge_base.py:43):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    results = await index.query(
        VectorQuery(
            vector=query_vector,              # [0.023, -0.145, 0.089, ...]
            vector_field_name="vector",
            return_fields=["name", "description"],
            num_results=5,
        )
    )

    # Behind the scenes: FT.SEARCH rag_doc
    #   "*=>[KNN 5 @vector $vec]"
    #   PARAMS 2 vec <binary_vector>


    📦 Redis Storage (Hashes with Vector Fields):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Key:    rag_doc:documentation:redis-vector-search:0

    Value (Hash):
    name         → "Redis Vector Search - Overview"
    description  → "Redis provides native vector similarity search through
                    RediSearch. Supports HNSW and FLAT indexing algorithms..."
    source_file  → "redis-vector-search.md"
    type         → "documentation"
    chunk_index  → "0"
    vector       → <6144 bytes of float32>

    Index: FLAT or HNSW algorithm for fast similarity search


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 15 - STEP 11: VECTOR SEARCH RESULTS
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 11: Vector Search Returns Top 5 Documents


    Search Performance:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    • Query: "Redis vector search capabilities"
    • Time: 0.5-2ms (sub-millisecond for 10K documents)
    • Algorithm: Cosine similarity
    • Results: Top 5 most similar documents


    Results Returned to Agent:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Search results for 'Redis vector search capabilities':

    1. Redis Vector Search - Overview: Redis provides native vector
       similarity search through RediSearch. Supports HNSW and FLAT
       indexing algorithms for fast approximate/exact nearest neighbor search.

    2. HNSW Algorithm Performance: Hierarchical Navigable Small World
       graphs offer O(log n) search complexity with 95%+ recall rates.

    3. Benchmarking Vector Search: Performance tests on 1M vectors show
       1.2ms P95 latency with HNSW indexing on commodity hardware.

    4. FLAT vs HNSW Trade-offs: FLAT provides exact search with 100%
       recall but O(n) time. HNSW is faster for large datasets.

    5. Production Deployments: Real-world implementations handle 10M+
       vectors with <5ms query latency using Redis vector search.


    Code: These results are added to the conversation as a tool message


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 16 - STEP 12: ITERATION 2 - FINAL ANSWER
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 12: Iteration 2 - LLM Formulates Final Answer


    Conversation State:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "User question: what's Redis vector search?"},
        {"role": "assistant", "tool_calls": [...]},  # search_knowledge_base call
        {"role": "tool", "content": "Search results: 1. Redis Vector..."}
    ]


    LLM's Reasoning:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Input:  Search results with 5 relevant documents

    Thinks: "I have comprehensive information about Redis vector search,
             including algorithms, performance, and trade-offs. I can now
             formulate a complete answer following Slack formatting rules."

    Decision: Return final response (no more tool calls)


    Response Format (JSON):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    {
      "response": "Redis vector search provides native semantic search...",
      "use_org_search": false
    }

    Note: System prompt instructs LLM to return JSON with these exact keys


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 17 - STEP 13: STORE ANSWER IN REDIS
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 13: Store Answer for Analytics & Feedback


    Code (app/agent/tasks/slack_tasks.py:225):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    answer_key = keys.answer_key(user_id, text, thread_ts)
    answer_data = {
        "id": str(ULID()),                               # Unique ID
        "user_id": user_id,
        "question": text,
        "answer": response,
        "accepted": "",                                  # Updated on feedback
        "created_at": datetime.now(timezone.utc).timestamp(),
        "updated_at": datetime.now(timezone.utc).timestamp(),
        "thread_ts": thread_ts or "",
        "channel_id": channel_id or "",
    }

    async with get_answer_index() as answer_index:
        await answer_index.load(data=[answer_data], id_field="id", keys=[answer_key])


    📦 Redis Storage (JSON Document):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Key:    answer:U12345ABC-a8f3c9d2-1234567890.123456

    Value (JSON):
    {
      "id": "01HN3KQZX9M8V7B6N5C4T3R2P1",
      "user_id": "U12345ABC",
      "question": "what's Redis vector search?",
      "answer": "Redis vector search provides native semantic search...",
      "accepted": "",
      "created_at": 1705315815.123,
      "updated_at": 1705315815.123,
      "thread_ts": "1234567890.123456",
      "channel_id": "C789XYZ"
    }


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 18 - STEP 14: POST TO SLACK WITH FEEDBACK BUTTONS
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 14: Post Response to Slack with Feedback Buttons


    Code (app/agent/tasks/slack_tasks.py:171):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
                    "action_id": "feedback_thumbs_down",
                }
            ]
        }
    ]


    What User Sees:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ┌───────────────────────────────────────────────────────────────┐
    │ 🤖 Haink (10:30:20 AM)                                       │
    │                                                               │
    │ Redis vector search provides native semantic search          │
    │ capabilities using HNSW and FLAT indexing algorithms...      │
    │                                                               │
    │ [👍 Helpful]  [👎 Not Helpful]                              │
    └───────────────────────────────────────────────────────────────┘

    Total time: ~5 seconds (most of that is LLM inference!)


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 19 - STEP 15: USER FEEDBACK LOOP
═══════════════════════════════════════════════════════════════════════════════════════════════════

                Step 15: User Clicks Feedback → Update Redis


    User Action:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Sarah clicks: 👍 Helpful


    Code (app/api/main.py:248):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async def handle_feedback_action(ack, body, logger):
        await ack()  # Acknowledge immediately

        value = action.get("value")  # "thumbs_up:answer:U12345ABC-a8f3c9d2-..."
        accepted = value.startswith("thumbs_up")
        answer_key = value.split(":", 1)[1]

        # Queue feedback update as background task
        async with Docket(url=get_redis_url()) as docket:
            await docket.add(update_answer_feedback, key=feedback_key)(
                answer_key=answer_key,
                accepted=accepted,
            )


    Code (app/agent/tasks/slack_tasks.py:250):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async def update_answer_feedback(answer_key: str, accepted: bool):
        await redis_client.json().set(answer_key, "$.accepted", "true")
        await redis_client.json().set(answer_key, "$.updated_at", timestamp)


    📦 Redis Storage (JSON Path Update):
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Key:    answer:U12345ABC-a8f3c9d2-1234567890.123456
    Update: $.accepted → "true"
            $.updated_at → 1705315820.456


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 20 - COMPLETE JOURNEY SUMMARY
═══════════════════════════════════════════════════════════════════════════════════════════════════

                        Complete Journey: 15 Steps in ~5 Seconds


     Step  Action                                    Redis Storage
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

     1.   Webhook arrives                            -
     2.   Queue task                                 Stream entry
     3.   Worker picks up                            Read from Stream
     4.   Track participation                        String (TTL)
     5.   Send "Thinking..."                         -
     6.   Gather thread context                      -
     7.   Agent starts ReAct loop                    -
     8.   Decide: search knowledge base              -
     9.   Check embedding cache                      String (binary, cached)
     10.  Vector search                              Read Hashes (vectors)
     11.  Return top 5 docs                          -
     12.  Formulate answer                           -
     13.  Store answer                               JSON document
     14.  Post to Slack                              -
     15.  User feedback                              JSON update


    Redis Operations Count:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    • 1 Stream write (task queue)
    • 1 Stream read (worker poll)
    • 1 String write (thread tracking)
    • 1 String read (embedding cache check)
    • 1 Vector search (KNN query)
    • 1 JSON write (answer storage)
    • 1 JSON update (feedback)

    Total: 7 Redis operations, all sub-millisecond


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 21 - ALL REDIS DATA TYPES IN ONE DATABASE
═══════════════════════════════════════════════════════════════════════════════════════════════════

                All Redis Data Types Used in This Journey


    What We Stored:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    1. Stream (Task Queue)
       Key:   docket:applied-ai-agent:tasks
       Why:   Guaranteed delivery, consumer groups, redelivery

    2. String + TTL (Thread Tracking)
       Key:   thread_participation:C789XYZ:1234567890.123456
       Why:   Auto-expiring flag, atomic operations

    3. String Binary (Embedding Cache)
       Key:   embedding:cache:text-embedding-3-small:5a8f3c9d2e1b4f6a...
       Why:   Fast binary storage, 24h TTL, 65% cost savings

    4. Hash + Vector (Knowledge Base)
       Key:   rag_doc:documentation:redis-vector-search:0
       Why:   Multi-field documents with vector similarity search

    5. JSON (Answer Storage)
       Key:   answer:U12345ABC-a8f3c9d2-1234567890.123456
       Why:   Flexible schema, path-based updates, queryable


    All in ONE Redis instance:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    • Single connection string
    • Unified backup/restore
    • Sub-millisecond performance across all types
    • One monitoring dashboard


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

```
═══════════════════════════════════════════════════════════════════════════════════════════════════
SLIDE 22 - NEXT STEPS
═══════════════════════════════════════════════════════════════════════════════════════════════════

                            What You've Learned Today


    Technical Deep Dive Complete:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ✓ Followed one message through 15 steps end-to-end
    ✓ Saw exactly how Redis is used at each step
    ✓ Examined actual key patterns and data structures
    ✓ Understood why each Redis data type was chosen
    ✓ Saw real code from production application


    Key Takeaways:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    • ONE Redis database handles 5+ use cases
    • Every operation is sub-millisecond
    • Each data type optimized for its purpose
    • Production-ready patterns (queues, retries, TTLs)
    • 70% cost savings vs. multi-database approach


    Try It Yourself:
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    📦 github.com/redis-applied-ai/redis-slack-worker-agent

    📚 Full-Overview.md (this entire walkthrough in detail)

    🚀 docker-compose up (run it locally in 5 minutes)

    💬 brandon.amos@redis.com (let's build your agent)


═══════════════════════════════════════════════════════════════════════════════════════════════════
```

---

## 📋 Presentation Guide

### Slide Structure:
- **Slides 1-4:** Introduction & Setup (5 min)
- **Slides 5-10:** Early Steps - Webhook to Context (10 min)
- **Slides 11-16:** Agent Brain - ReAct Loop & Search (10 min)
- **Slides 17-20:** Storage & Summary (5 min)
- **Slides 21-22:** Recap & Next Steps (5 min)
- **Total: 35 minutes** + Q&A

### Key Presentation Tips:

1. **Slow Down on Redis Storage Slides**
   - Let audience see the actual keys and values
   - Explain why each data type was chosen
   - These are the "aha!" moments

2. **Emphasize the Journey**
   - "We're at Step X of 15"
   - "Remember, all of this is in ONE database"
   - Point back to previous steps

3. **Use the Code Snippets**
   - Show that this is real, production code
   - File paths give credibility
   - Encourage exploration of the repo

4. **Highlight Redis Operations**
   - "Notice: sub-millisecond every time"
   - "This is why Redis works - fast everywhere"

### Font Recommendations:
- **Monospace:** Consolas, Courier New, SF Mono (14-16pt)
- **Background:** Dark (#1a1a1a)
- **Text:** Light gray/white (#e0e0e0)
- **Accent:** Redis Red (#DC382D) for titles

Ready to copy-paste into PowerPoint!
