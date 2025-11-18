# Complete System Walkthrough - Haink AI Agent

This document provides a comprehensive walkthrough of the Haink Slack bot architecture, showing how every component works together with Redis as the central backbone.

## 🎯 What This System Does

**Haink** is an AI-powered Slack bot that helps the Applied AI team at Redis answer questions about Redis AI capabilities. It uses:
- **RAG (Retrieval Augmented Generation)** to search a knowledge base
- **ReAct methodology** where the AI agent reasons and takes actions iteratively
- **Agent Memory Server** to remember past conversations with users
- **Asynchronous task processing** to avoid blocking Slack webhooks

---

## 🏗️ High-Level Architecture

```
┌─────────────┐
│    Slack    │
│   (Users)   │
└──────┬──────┘
       │ Webhook POST
       │ /slack/events
       ▼
┌─────────────────────────────────────────────────────────────┐
│                     FastAPI Application                      │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐          │
│  │   Slack    │  │  Content   │  │    Auth      │          │
│  │  Webhook   │  │  Management│  │   (Auth0)    │          │
│  │  Handler   │  │    API     │  │              │          │
│  └────────────┘  └────────────┘  └──────────────┘          │
└────────────────────────┬────────────────────────────────────┘
                         │ Queue Tasks
                         ▼
              ┌──────────────────────┐
              │   Redis (Single DB)  │
              │  ┌────────────────┐  │
              │  │  Streams       │  │ ◄─── Task Queue
              │  │  Hashes        │  │ ◄─── Vector Docs
              │  │  JSON          │  │ ◄─── Answers/Memory
              │  │  Strings+TTL   │  │ ◄─── Rate Limiting
              │  └────────────────┘  │
              └──────────┬───────────┘
                         │ Poll Tasks
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Worker (Docket)                           │
│  ┌────────────────────────────────────────────────────┐     │
│  │              Agent Engine (ReAct Loop)             │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │     │
│  │  │Knowledge │  │   Web    │  │    Memory    │    │     │
│  │  │  Base    │  │  Search  │  │    Search    │    │     │
│  │  │  Tool    │  │   Tool   │  │     Tool     │    │     │
│  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘    │     │
│  │       │             │                │            │     │
│  └───────┼─────────────┼────────────────┼────────────┘     │
└──────────┼─────────────┼────────────────┼──────────────────┘
           │             │                │
           ▼             ▼                ▼
    ┌──────────┐  ┌──────────┐  ┌────────────────┐
    │  Redis   │  │  Tavily  │  │ Agent Memory   │
    │  Vector  │  │   API    │  │    Server      │
    │  Search  │  │  (Web)   │  │   (Redis)      │
    └──────────┘  └──────────┘  └────────────────┘
```

**Key Components:**
- **FastAPI API**: Handles Slack webhooks, acknowledges within 3 seconds, queues work
- **Redis**: Single database for everything (queues, vectors, documents, cache, sessions)
- **Worker**: Background process that executes tasks using Docket
- **Agent Engine**: ReAct-style loop that calls tools and reasons about responses
- **Tools**: Knowledge base search, web search, memory operations

---

## 🚀 The Journey of a Slack Message

Let's follow a complete user interaction from start to finish.

### Step 1: User Mentions the Bot

```
User in #engineering: "@Haink what's Redis vector search?"
```

### Step 2: Slack Webhook Arrives

Slack sends an HTTP POST to `/slack/events`. The FastAPI app receives it:

**Code: app/api/main.py:137**
```python
async def handle_app_mentions(body, say, ack):
    await ack()  # Acknowledge immediately (Slack requires response within 3 seconds)

    user = body["event"]["user"]           # "U12345ABC"
    text = body["event"]["text"]           # "what's Redis vector search?"
    channel = body["event"]["channel"]     # "C789XYZ"
    thread_ts = body["event"].get("thread_ts")  # "1234567890.123456"
```

**Critical detail**: The bot must acknowledge the Slack event within 3 seconds or Slack will retry. That's why we immediately call `ack()` and then queue the work for later.

---

### Step 3: Queue the Task

Instead of processing immediately, the API queues the task to Redis:

**Code: app/api/main.py:126-134**
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

**Flow Diagram:**
```
┌─────────────┐
│    Slack    │
└──────┬──────┘
       │ 1. POST /slack/events
       ▼
┌─────────────────────┐
│   FastAPI (API)     │
│                     │
│  handle_mentions()  │
│        │            │
│        │ 2. ack()   │
│        │            │
│        ▼            │
│  docket.add()       │
│        │            │
└────────┼────────────┘
         │ 3. XADD (queue task)
         ▼
┌─────────────────────┐
│   Redis Streams     │
│                     │
│  docket:applied-    │
│  ai-agent:tasks     │
│                     │
│  [Task Entry]       │
│  - function name    │
│  - arguments        │
│  - retry count      │
└─────────────────────┘
         │
         │ 4. XREADGROUP (poll)
         ▼
┌─────────────────────┐
│  Worker (Docket)    │
│                     │
│  Waiting for        │
│  tasks...           │
└─────────────────────┘
```

#### 📦 Redis Storage: Task Queue

**How Redis is used:** Docket uses Redis Streams to queue background tasks. This ensures the task is persisted and will be processed even if the worker is temporarily down.

**Key:**
```
docket:applied-ai-agent:tasks
```

**Value (Stream Entry):**
```
1705315800123-0 {
  "task": "app.agent.tasks.slack_tasks:process_slack_question_with_retry",
  "key": "question-U12345ABC-a8f3c9d2-1234567890.123456",
  "args": "{\"user_id\":\"U12345ABC\",\"text\":\"what's Redis vector search?\",\"channel_id\":\"C789XYZ\",\"thread_ts\":\"1234567890.123456\"}",
  "retry_count": "0"
}
```

---

### Step 4: Worker Picks Up the Task

A separate Worker process runs continuously, polling Redis Streams:

**Code: app/worker/worker.py:107**
```python
await Worker.run(
    docket_name="applied-ai-agent",
    url=redis_url,
    concurrency=1,
    redelivery_timeout=timedelta(seconds=60),
    tasks=["app.worker.task_registration:all_tasks"],
)
```

**What this does:**
- Continuously polls Redis Streams for new tasks
- When it finds one, looks up the task function by name
- Executes the function with the queued arguments
- Has retry logic built-in (if task fails, retry up to 3 times)

---

### Step 5: Track Thread Participation

Before processing, track that the bot is engaging with this thread:

**Code: app/agent/tasks/slack_tasks.py:386**
```python
await track_thread_participation(channel, thread_ts)
```

**Flow Diagram:**
```
┌─────────────────────┐
│   Redis Streams     │
│                     │
│  [Task Entry]       │
└──────┬──────────────┘
       │ XREADGROUP
       ▼
┌─────────────────────────────────────────┐
│         Worker Process                  │
│                                         │
│  process_slack_question_with_retry()    │
│         │                               │
│         ▼                               │
│  track_thread_participation()           │
│         │                               │
└─────────┼───────────────────────────────┘
          │ SET thread_participation:... "1" EX 3600
          ▼
┌─────────────────────┐
│   Redis Strings     │
│                     │
│  thread_           │
│  participation:    │
│  C789XYZ:123456    │
│                    │
│  Value: "1"        │
│  TTL: 3600s        │
└────────────────────┘
```

#### 📦 Redis Storage: Thread Participation

**How Redis is used:** Store a flag indicating the bot has participated in this thread, preventing over-engagement. The key expires after 1 hour automatically.

**Key:**
```
thread_participation:C789XYZ:1234567890.123456
```

**Value:**
```
"1"
```

**TTL:** 3600 seconds (1 hour)

---

### Step 6: Send Progress Update

**Code: app/agent/tasks/slack_tasks.py:146**
```python
await progress_callback("Thinking...")
```

This sends a Slack message immediately: "_Thinking..._" so the user knows the bot is working.

**Flow Diagram:**
```
┌─────────────────────┐
│      Worker         │
│                     │
│  progress_callback  │
│  ("Thinking...")    │
└──────┬──────────────┘
       │ Slack API
       ▼
┌─────────────────────┐
│      Slack          │
│                     │
│  User sees:         │
│  "Thinking..."      │
└─────────────────────┘
```

---

### Step 7: Gather Thread Context

If this is in a thread, get the conversation history:

**Code: app/agent/tasks/slack_tasks.py:36**
```python
async def get_thread_context(channel_id: str, thread_ts: str) -> list[dict]:
    # Get conversation replies (thread messages)
    result = await slack_app.client.conversations_replies(
        channel=channel_id,
        ts=thread_ts,
        limit=50,  # Reasonable limit to avoid token limits
    )
```

This calls the Slack API to fetch up to 50 previous messages in the thread, giving the agent context about what's been discussed.

**Flow Diagram:**
```
┌─────────────────────┐
│      Worker         │
│                     │
│  get_thread_        │
│  context()          │
└──────┬──────────────┘
       │ conversations.replies
       ▼
┌─────────────────────┐
│   Slack API         │
│                     │
│  Returns last 50    │
│  messages in thread │
└─────────────────────┘
```

---

### Step 8: Generate RAG Response

**Code: app/agent/tasks/slack_tasks.py:123**
```python
async def generate_rag_response(user_id, text, thread_ts, channel_id):
    # Send immediate acknowledgment
    await progress_callback("Thinking...")

    # Get the Redis vector index
    index = get_document_index()
    vectorizer = get_vectorizer()

    # Gather thread context
    thread_context = await get_thread_context(channel_id, thread_ts)

    # Process the question using agentic RAG
    session_id = thread_ts or f"channel_{channel_id}"
    return await answer_question(
        index,
        vectorizer,
        text,
        session_id,
        user_id,
        thread_context=thread_context,
        progress_callback=progress_callback,
    )
```

This is where the magic happens! Let's dive into the agent's reasoning loop...

---

## 🧠 The Agent's Reasoning Loop

The `answer_question` function implements a **ReAct-style agent loop**:

**Flow Diagram:**
```
┌──────────────────────────────────────────────────────────┐
│                   Worker Process                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │         answer_question() - ReAct Loop             │  │
│  │                                                     │  │
│  │  Iteration 1:                                      │  │
│  │  ┌──────────────────────────────────────────┐     │  │
│  │  │  LLM (OpenAI/Bedrock)                   │     │  │
│  │  │  - System Prompt (235 lines)            │     │  │
│  │  │  - User Question                        │     │  │
│  │  │  - Available Tools:                     │     │  │
│  │  │    • search_knowledge_base              │     │  │
│  │  │    • web_search                         │     │  │
│  │  │    • search_memory                      │     │  │
│  │  │    • add_memory                         │     │  │
│  │  └────────┬─────────────────────────────────┘     │  │
│  │           │                                        │  │
│  │           ▼                                        │  │
│  │  Decision: "I need to search knowledge base"      │  │
│  │                                                    │  │
│  │  Tool Call:                                       │  │
│  │  {                                                │  │
│  │    "name": "search_knowledge_base",              │  │
│  │    "arguments": {                                │  │
│  │      "query": "Redis vector search capabilities" │  │
│  │    }                                             │  │
│  │  }                                               │  │
│  └────────┬──────────────────────────────────────────┘  │
└───────────┼─────────────────────────────────────────────┘
            │
            ▼
     Execute Tool...
```

### Setup Phase

**Code: app/agent/core.py:317-327**
```python
provider = os.getenv("LLM_PROVIDER", "bedrock").lower()
if provider == "bedrock":
    return await answer_question_bedrock(...)  # Use AWS Bedrock

# Create initial messages
messages = [
    {"role": "system", "content": SYSTEM_PROMPT},  # 235-line instruction!
    {"role": "user", "content": initial_message},
]
```

The **SYSTEM_PROMPT** (app/agent/core.py:36-270) is 235 lines of carefully crafted instructions that tell the AI:
- How to format responses for Slack (use `•` not `*` for bullets)
- When to search the knowledge base vs. web
- How to be conversational and read social cues
- Character limits (12,000 chars max for Slack)
- When to use tools vs. answer directly

### The Tool Loop

**Code: app/agent/core.py:346-552**
```python
max_iterations = 25
tools = [
    get_search_knowledge_base_tool(),
    get_web_search_tool(),
    *MemoryAPIClient.get_all_memory_tool_schemas(),
]

while iteration < max_iterations:
    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
    )

    message = response.choices[0].message
    messages.append(message.model_dump())

    # Check if the model wants to use tools
    if message.tool_calls:
        # Execute each tool call
        for tool_call in message.tool_calls:
            # Execute tool and add result to messages
            ...
    else:
        # No tool calls - we have the final response
        break
```

**What happens in each iteration:**

1. **Call the LLM** with current conversation and available tools
2. **Check if it wants to use tools**
3. **Execute each tool** the LLM requested
4. **Add tool results** back to the conversation
5. **Loop again** - the LLM sees the tool results and can either make more tool calls or return a final answer

---

## 📘 Example 1: Knowledge Base Search Flow

Let's say the user asks: **"What's Redis vector search?"**

### Iteration 1: LLM Decides to Search

**LLM reasoning:**
> "I need specific information about Redis vector search from the knowledge base."

**Tool call:**
```json
{
    "name": "search_knowledge_base",
    "arguments": {
        "query": "Redis vector search capabilities"
    }
}
```

### Tool Execution

**Complete Flow Diagram:**
```
┌─────────────────────────────────────────────────────────────┐
│                    Agent (Iteration 1)                       │
│                                                              │
│  Tool Call: search_knowledge_base                           │
│  Args: "Redis vector search capabilities"                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              search_knowledge_base()                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. Generate Embedding                               │   │
│  │     vectorizer.embed(query)                          │   │
│  └────────────┬─────────────────────────────────────────┘   │
└───────────────┼─────────────────────────────────────────────┘
                │
                ▼
        ┌───────────────┐
        │ Check Cache?  │
        └───┬───────┬───┘
            │       │
     Found  │       │ Not Found
            ▼       ▼
     ┌──────────┐  ┌──────────────────┐
     │  Redis   │  │  OpenAI API      │
     │  Cache   │  │  text-embedding- │
     │  GET     │  │  3-small         │
     └──────────┘  └────────┬─────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │  Redis Cache    │
                   │  SET with TTL   │
                   └─────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
                ▼                       ▼
┌───────────────────────────────────────────────────────────┐
│                    Vector Search                          │
│                                                           │
│  FT.SEARCH rag_doc                                       │
│    "*=>[KNN 5 @vector $vec]"                             │
│    PARAMS 2 vec <embedding_blob>                         │
│    RETURN 2 name description                             │
└─────────────┬─────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Redis Vector Index                        │
│                                                              │
│  rag_doc:documentation:redis-vector-search:0  (Hash)        │
│  rag_doc:documentation:redis-vector-search:1  (Hash)        │
│  rag_doc:blog:performance-benchmarks:0        (Hash)        │
│  ...                                                        │
│                                                             │
│  Cosine similarity search → Top 5 matches                  │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
         Format Results
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                Return to Agent                              │
│                                                             │
│  "Search results for 'Redis vector search capabilities':   │
│   1. Redis Vector Search - Overview: ...                   │
│   2. HNSW Algorithm Performance: ...                       │
│   3. ..."                                                  │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│              Agent (Iteration 2)                            │
│                                                             │
│  Messages now include:                                     │
│  - System prompt                                           │
│  - User question                                           │
│  - Tool call (search_knowledge_base)                       │
│  - Tool result (search results)                            │
│                                                            │
│  LLM Decision: "I have enough info, formulate answer"     │
│                                                            │
│  Returns final response (no more tool calls)              │
└─────────────────────────────────────────────────────────────┘
```

**Code: app/agent/core.py:391-426**
```python
if tool_call.function.name == "search_knowledge_base":
    # Send progress update to user
    await progress_callback("Searching knowledge base...")

    # Parse the search query from LLM's arguments
    args = json.loads(tool_call.function.arguments)
    search_query = args.get("query", "")

    # Perform the actual search
    search_results = await search_knowledge_base(index, vectorizer, search_query)

    # Add result to conversation
    tool_message = {
        "role": "tool",
        "tool_call_id": tool_call.id,
        "content": search_results,
    }
    messages.append(tool_message)
```

**Code: app/agent/tools/search_knowledge_base.py:18**
```python
async def search_knowledge_base(index, vectorizer, query, num_results=5):
    # Convert query to vector embedding
    query_vector = vectorizer.embed(query, as_buffer=True)

    # Search Redis with vector similarity
    results = await index.query(
        VectorQuery(
            vector=query_vector,
            vector_field_name="vector",
            return_fields=["name", "description"],
            num_results=5,
        )
    )

    # Format results
    context_lines = [f"Search results for '{query}':"]
    for i, result in enumerate(results, 1):
        name = result.get("name", "Unknown")
        description = result.get("description", "No description")
        context_lines.append(f"{i}. {name}: {description}")

    return "\n".join(context_lines)
```

#### 📦 Redis Storage: Embedding Cache

**How Redis is used:** Before searching, the query "Redis vector search capabilities" is converted to an embedding vector. This embedding is cached in Redis to avoid calling OpenAI's API repeatedly for the same query.

**Key:**
```
embedding:cache:text-embedding-3-small:5a8f3c9d2e1b4f6a7c8d9e0f1a2b3c4d
```

**Value:**
```
<binary blob: 6144 bytes representing 1536 float32 values>
```

**TTL:** 86400 seconds (24 hours)

#### 📦 Redis Storage: Vector Index

**How Redis is used:** The knowledge base documents are stored as Redis Hashes with vector embeddings. Redis performs a vector similarity search using the FLAT or HNSW algorithm.

**Key Pattern:**
```
rag_doc:documentation:redis-vector-search:0
```

**Value (Hash):**
```
name: "Redis Vector Search - Overview"
description: "Redis provides native vector similarity search through RediSearch. Supports HNSW and FLAT indexing algorithms..."
source_file: "redis-vector-search.md"
type: "documentation"
chunk_index: "0"
start_index: "0"
updated_at: "1705315800"
vector: <6144 bytes of float32 vector>
```

**How vector search works:**
1. Convert query to embedding: [0.023, -0.145, 0.089, ...]
2. Search Redis for documents with similar vectors using cosine distance
3. Return top 5 most similar documents

---

## 📘 Example 2: Memory Search Flow

Let's say the user asks: **"What did we discuss last week?"**

### Iteration 1: LLM Decides to Search Memory

**LLM reasoning:**
> "The user is asking about a past conversation. I should use search_memory."

**Tool call:**
```json
{
    "name": "search_memory",
    "arguments": {
        "query": "discussion topics last week",
        "user_id": "U12345ABC"
    }
}
```

### Tool Execution with User Isolation

**Complete Flow Diagram:**
```
User asks: "What did we discuss last week?"

┌─────────────────────────────────────────────────────────────┐
│                    Agent (Iteration 1)                       │
│                                                              │
│  LLM analyzes: "past conversation" → use search_memory     │
│                                                              │
│  Tool Call: search_memory                                   │
│  Args: {                                                    │
│    "query": "discussion topics last week",                  │
│    "user_id": "U12345ABC"                                   │
│  }                                                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Memory Tool Execution                          │
│                                                             │
│  1. Enforce user_id (security!)                            │
│     args["user_id"] = "U12345ABC"  # Always set           │
│                                                            │
│  2. Call Agent Memory Server                              │
│     memory_client.resolve_tool_call(...)                  │
└────────────────────┬───────────────────────────────────────┘
                     │ HTTP POST
                     ▼
┌─────────────────────────────────────────────────────────────┐
│            Agent Memory Server                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1. Parse request                                    │  │
│  │  2. Generate embedding for query                     │  │
│  │  3. Search Redis for similar memories               │  │
│  └────────────┬─────────────────────────────────────────┘  │
└───────────────┼─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Redis (Memory Store)                      │
│                                                              │
│  FT.SEARCH memory:user:U12345ABC:long_term                 │
│    "*=>[KNN 5 @embedding $vec]"                            │
│    PARAMS 2 vec <query_embedding>                          │
│    RETURN 4 content created_at entities topics             │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│  memory:user:U12345ABC:long_term:01HN3K...  (JSON)          │
│  memory:user:U12345ABC:long_term:01HN3L...  (JSON)          │
│  memory:user:U12345ABC:long_term:01HN3M...  (JSON)          │
│                                                              │
│  Returns top 5 matching memories                            │
└─────────────┬────────────────────────────────────────────────┘
              │
              ▼
         Format & Return
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│              Return to Agent                                │
│                                                             │
│  "Memory search results:                                   │
│   - Last week you asked about Redis vector search          │
│   - Discussed HNSW vs FLAT algorithms                      │
│   - You were interested in performance benchmarks"         │
└─────────────────────────────────────────────────────────────┘
```

**Code: app/agent/core.py:474-548**
```python
else:
    # Handle memory tools
    memory_client = await get_memory_client()

    # Parse the LLM's arguments
    args = json.loads(tool_call.function.arguments)

    # CRITICAL: Always enforce the user_id in memory tool calls
    # This ensures we never leave user association to chance
    memory_tool_names = {
        "search_memory", "add_memory_to_working_memory",
        "update_working_memory_data", "get_working_memory",
        "search_long_term_memory", "memory_prompt", "set_working_memory"
    }

    if tool_call.function.name in memory_tool_names:
        # Force the user_id to always be the actual Slack user ID
        args["user_id"] = user_id
        logger.info(f"Enforced user_id={user_id} for {tool_call.function.name}")

    # Execute the memory tool call
    result = await memory_client.resolve_tool_call(
        tool_call={"name": tool_call.function.name, "arguments": json.dumps(args)},
        session_id=session_id,
        user_id=user_id,
    )
```

#### 📦 Redis Storage: User Memories

**How Redis is used:** The Agent Memory Server stores user memories as JSON documents in Redis with vector embeddings. It performs vector similarity search to find relevant past conversations.

**Key:**
```
memory:user:U12345ABC:long_term:01HN3KQZX9M8V7B6N5C4T3R2P1
```

**Value (JSON):**
```json
{
    "id": "01HN3KQZX9M8V7B6N5C4T3R2P1",
    "user_id": "U12345ABC",
    "session_id": "1234567890.123456",
    "content": "User asked about Redis vector search performance. Discussed HNSW vs FLAT algorithms and benchmarking strategies.",
    "memory_type": "long_term",
    "created_at": "2024-01-08T14:22:00Z",
    "importance": 0.85,
    "entities": ["Redis", "vector search", "HNSW", "FLAT"],
    "topics": ["databases", "performance"],
    "embedding": [0.023, -0.145, 0.089, ...],
    "consolidated": true
}
```

**Why enforce user_id?**
This ensures data isolation - each user only sees their own memories, preventing accidental data leakage between users.

---

## 📘 Example 3: Web Search Flow

Let's say the user asks: **"What's new with OpenAI this week?"**

### Iteration 1: LLM Decides to Use Web Search

**From SYSTEM_PROMPT (app/agent/core.py:91-102):**
> "Use web_search for:
> - Questions with recency indicators ('latest', 'recent', 'current', 'new', 'this week')
> - Breaking news or recent developments"

**LLM reasoning:**
> "The user is asking about '*new this week*' - this is a recency question. I should use web_search."

**Tool call:**
```json
{
    "name": "web_search",
    "arguments": {
        "query": "OpenAI announcements news this week 2024"
    }
}
```

### Tool Execution

**Complete Flow Diagram:**
```
User asks: "What's new with OpenAI this week?"

┌─────────────────────────────────────────────────────────────┐
│                    Agent (Iteration 1)                       │
│                                                              │
│  LLM analyzes: "new this week" = recency → use web_search  │
│                                                              │
│  Tool Call: web_search                                      │
│  Args: {                                                    │
│    "query": "OpenAI announcements news this week 2024"      │
│  }                                                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              perform_web_search()                           │
│                                                             │
│  Send "Searching the web..." to Slack                      │
└────────────────────┬───────────────────────────────────────┘
                     │ HTTPS Request
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   Tavily API (External)                      │
│                                                              │
│  Real-time web search                                       │
│  Returns:                                                   │
│  - News articles                                            │
│  - Blog posts                                               │
│  - Documentation                                            │
│  - Relevance scores                                         │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
         Format Results
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│              Return to Agent                                │
│                                                             │
│  "Web search results:                                      │
│   1. OpenAI Announces GPT-5 Preview (Jan 14)              │
│   2. New OpenAI API Pricing (Jan 13)                      │
│   3. Fine-tuning for GPT-4 Available (Jan 12)"            │
└─────────────────────────────────────────────────────────────┘
```

**Code: app/agent/core.py:428-473**
```python
elif tool_call.function.name == "web_search":
    # Notify user we're searching the web
    await progress_callback("Searching the web...")

    from app.agent.tools.web_search import perform_web_search

    args = json.loads(tool_call.function.arguments)
    search_query = args.get("query", "")

    search_results = await perform_web_search(
        query=search_query,
        search_depth="basic",
        max_results=5,
        redis_focused=True,
    )

    await progress_callback("Analyzing results...")

    tool_message = {
        "role": "tool",
        "tool_call_id": tool_call.id,
        "content": search_results,
    }
    messages.append(tool_message)
```

---

## 📤 Storing the Answer & Posting to Slack

Once the agent has formulated a final answer, it stores the Q&A pair and posts to Slack.

**Flow Diagram:**
```
┌─────────────────────────────────────────────────────────────┐
│                    Agent                                     │
│                                                              │
│  Final Answer Generated                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              store_answer_data()                            │
│                                                             │
│  1. Generate answer key                                    │
│  2. Create answer document                                 │
│  3. Store in Redis                                         │
└────────────────────┬───────────────────────────────────────┘
                     │ JSON.SET
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Redis (JSON)                              │
│                                                              │
│  answer:U12345ABC-a8f3c9d2-1234567890.123456               │
│  {                                                          │
│    "question": "what's Redis vector search?",              │
│    "answer": "Redis vector search is...",                  │
│    "accepted": "",                                         │
│    "user_id": "U12345ABC",                                 │
│    ...                                                     │
│  }                                                         │
└─────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              post_slack_message()                           │
│                                                             │
│  Create blocks with:                                       │
│  - Answer text (markdown)                                  │
│  - Feedback buttons (👍 👎)                                │
└────────────────────┬───────────────────────────────────────┘
                     │ Slack API
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Slack                                     │
│                                                              │
│  Message posted with:                                       │
│  ┌──────────────────────────────────────────────┐          │
│  │ Redis vector search is a powerful feature... │          │
│  │                                               │          │
│  │ [👍 Helpful]  [👎 Not Helpful]              │          │
│  └──────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

**Code: app/agent/tasks/slack_tasks.py:225**
```python
async def store_answer_data(user_id, text, response, channel_id, thread_ts):
    answer_key = keys.answer_key(user_id, text, thread_ts)
    answer_data = {
        "id": str(ULID()),
        "user_id": user_id,
        "question": text,
        "answer": response,
        "accepted": "",  # Updated when user clicks thumbs up/down
        "created_at": datetime.now(timezone.utc).timestamp(),
        "updated_at": datetime.now(timezone.utc).timestamp(),
        "thread_ts": thread_ts or "",
        "channel_id": channel_id or "",
    }
    async with get_answer_index() as answer_index:
        await answer_index.load(data=[answer_data], id_field="id", keys=[answer_key])
    return answer_key
```

#### 📦 Redis Storage: Answer Tracking

**How Redis is used:** Store the Q&A pair as a JSON document for analytics and feedback tracking. This allows searching for similar questions and analyzing which answers users found helpful.

**Key:**
```
answer:U12345ABC-a8f3c9d2-1234567890.123456
```

**Value (JSON):**
```json
{
    "id": "01HN3KQZX9M8V7B6N5C4T3R2P1",
    "user_id": "U12345ABC",
    "question": "what's Redis vector search?",
    "answer": "Redis vector search is...",
    "accepted": "",
    "created_at": 1705315800.123,
    "updated_at": 1705315800.123,
    "thread_ts": "1234567890.123456",
    "channel_id": "C789XYZ"
}
```

**Code: app/agent/tasks/slack_tasks.py:171**
```python
async def post_slack_message(user_id, text, thread_ts, response, channel_id):
    # First, store the answer data
    answer_key = await store_answer_data(user_id, text, response, channel_id, thread_ts)

    # Create blocks with response text and feedback buttons
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
                },
            ],
        },
    ]

    await get_slack_app().client.chat_postMessage(
        channel=channel_id,
        text=response,
        blocks=blocks,
        thread_ts=thread_ts,
    )
```

---

## 👍 Handling Feedback

When a user clicks the thumbs up or thumbs down button:

**Flow Diagram:**
```
┌─────────────────────────────────────────────────────────────┐
│                    Slack (User)                              │
│                                                              │
│  User clicks: 👍 Helpful                                    │
└────────────────────┬────────────────────────────────────────┘
                     │ POST /slack/interactive
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                FastAPI (handle_feedback_action)             │
│                                                             │
│  1. ack() - Acknowledge immediately                        │
│  2. Extract answer_key from button value                   │
│  3. Queue feedback update task                             │
└────────────────────┬───────────────────────────────────────┘
                     │ XADD (queue task)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                Redis Streams                                │
│                                                             │
│  docket:applied-ai-agent:tasks                             │
│  [New Entry]                                               │
│  - task: update_answer_feedback                            │
│  - args: {answer_key, accepted: true}                     │
└────────────────────┬───────────────────────────────────────┘
                     │ XREADGROUP
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                Worker (Background)                          │
│                                                             │
│  update_answer_feedback()                                  │
│  - Get answer from Redis                                   │
│  - Update accepted field                                   │
│  - Update timestamp                                        │
└────────────────────┬───────────────────────────────────────┘
                     │ JSON.SET $.accepted "true"
                     │ JSON.SET $.updated_at <timestamp>
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                Redis (JSON Update)                          │
│                                                             │
│  answer:U12345ABC-a8f3c9d2-1234567890.123456               │
│  {                                                          │
│    "question": "what's Redis vector search?",              │
│    "answer": "Redis vector search is...",                  │
│    "accepted": "true",  ← UPDATED                          │
│    "updated_at": 1705315810.456  ← UPDATED                │
│    ...                                                     │
│  }                                                         │
└─────────────────────────────────────────────────────────────┘
```

**Code: app/api/main.py:248**
```python
async def handle_feedback_action(ack, body, logger):
    await ack()

    # Extract the answer key from the button value
    action = body.get("actions", [{}])[0]
    value = action.get("value")  # "thumbs_up:answer:U12345ABC-a8f3c9d2-..."
    accepted = value.startswith("thumbs_up")
    answer_key = value.split(":", 1)[1]

    # Queue a task to update the feedback
    async with Docket(url=get_redis_url()) as docket:
        await docket.add(update_answer_feedback, key=feedback_key)(
            answer_key=answer_key,
            accepted=accepted,
        )
```

**Code: app/agent/tasks/slack_tasks.py:250**
```python
async def update_answer_feedback(answer_key: str, accepted: bool):
    async with get_redis_client() as redis_client:
        # Update the accepted field directly
        await redis_client.json().set(answer_key, "$.accepted", str(accepted).lower())
        await redis_client.json().set(answer_key, "$.updated_at",
                                      datetime.now(timezone.utc).timestamp())
```

#### 📦 Redis Storage: Feedback Update

**How Redis is used:** Update the stored answer document's `accepted` field using Redis JSON's path-based update.

**Key:**
```
answer:U12345ABC-a8f3c9d2-1234567890.123456
```

**Updated Value:**
```json
{
    "id": "01HN3KQZX9M8V7B6N5C4T3R2P1",
    "user_id": "U12345ABC",
    "question": "what's Redis vector search?",
    "answer": "Redis vector search is...",
    "accepted": "true",
    "created_at": 1705315800.123,
    "updated_at": 1705315810.456,
    "thread_ts": "1234567890.123456",
    "channel_id": "C789XYZ"
}
```

---

## 🧵 Special Features: Thread Awareness

### Bump Detection

If someone just says "@Haink" with no question (a "bump"), the bot analyzes the thread:

**Code: app/api/main.py:79**
```python
if len(remaining_text) <= 3:  # Just a mention, no real content
    logger.info(f"Detected 'bump' from user {user}")

    thread_context = await get_thread_context(channel, thread_ts)
    should_bump_respond = await evaluate_bump_context(thread_context)

    if should_bump_respond:
        # Respond based on thread context
    else:
        # Say "I'm not sure how to help"
```

**Code: app/agent/tasks/slack_tasks.py:450**
```python
async def evaluate_bump_context(thread_context: list[dict]) -> bool:
    """Evaluate if a 'bump' should trigger a response based on thread context."""
    if not thread_context:
        return False

    # Look at the last 5 messages for context
    recent_messages = thread_context[-5:] if len(thread_context) >= 5 else thread_context

    # Check for unanswered questions
    for msg in reversed(recent_messages):
        message_text = msg.get("text", "")

        # Look for question indicators
        if "?" in message_text:
            return True

        # Look for help-seeking language
        help_indicators = ["help", "how do", "how can", "what should", "need to", "trying to"]
        if any(indicator in message_text.lower() for indicator in help_indicators):
            return True

        # Look for technical discussions
        tech_terms = ["redis", "vector", "cache", "database", "search", "index"]
        if any(term in message_text.lower() for term in tech_terms):
            return True

    return False
```

### Rate Limiting

Prevent the bot from responding too frequently in the same thread:

**Code: app/agent/tasks/slack_tasks.py:431**
```python
async def check_rate_limit(channel_id: str, thread_ts: str, max_responses: int = 3):
    """Check if we've hit the rate limit for responses in this thread."""
    client = get_redis_client()
    rate_limit_key = keys.thread_rate_limit_key(channel_id, thread_ts)

    # Check current count
    current_count = await client.get(rate_limit_key)
    if current_count and int(current_count) >= max_responses:
        return True  # Rate limited!

    # Increment counter
    await client.incr(rate_limit_key)
    await client.expire(rate_limit_key, 3600)  # 1 hour expiry
    return False
```

#### 📦 Redis Storage: Rate Limiting

**How Redis is used:** Track how many times the bot has responded in a thread within the last hour using atomic increment operations.

**Key:**
```
thread_rate_limit:C789XYZ:1234567890.123456
```

**Value:**
```
"2"
```

**TTL:** 3600 seconds (resets after 1 hour)

---

## 🔄 Complete End-to-End Flow

```
┌──────────┐
│  Slack   │ "@Haink what's Redis vector search?"
└────┬─────┘
     │ 1. Webhook POST
     ▼
┌────────────────┐
│  FastAPI API   │ ack() + queue task
└────┬───────────┘
     │ 2. XADD (Redis Streams)
     ▼
┌────────────────────────────────────────────────────────────┐
│                       REDIS                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Streams    │  │    Hashes    │  │     JSON     │    │
│  │  Task Queue  │  │  Vector Docs │  │   Answers    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Strings+TTL  │  │String(binary)│  │     JSON     │    │
│  │Thread Track  │  │Embed Cache   │  │   Memories   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
└────────┬───────────────────────────────────────────────────┘
         │ 3. XREADGROUP (poll)
         ▼
┌────────────────────────────────────────────────────────────┐
│                      Worker                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               Agent (ReAct Loop)                     │  │
│  │                                                      │  │
│  │  Iteration 1: Call LLM → Decide tool                │  │
│  │  Iteration 2: Execute tool → Add results            │  │
│  │  Iteration 3: Call LLM → Final answer              │  │
│  └──────┬───────────────────────────────────────────────┘  │
└─────────┼──────────────────────────────────────────────────┘
          │
          │ 4. During iterations, tools access:
          │
          ├──────► Redis Vector Search (knowledge base)
          │
          ├──────► Redis JSON (memories)
          │
          └──────► External APIs (web search)

          │ 5. Store answer
          ▼
     ┌────────────┐
     │   Redis    │ JSON.SET answer:...
     │    JSON    │
     └────────────┘
          │
          │ 6. Post to Slack
          ▼
     ┌────────────┐
     │   Slack    │ Message with buttons
     └────┬───────┘
          │ 7. User clicks 👍
          ▼
     ┌────────────┐
     │  FastAPI   │ Queue feedback task
     └────┬───────┘
          │ 8. XADD
          ▼
     ┌────────────┐
     │   Redis    │ Streams + JSON update
     │  Streams   │
     └────────────┘
```

---

## 🗄️ Redis Data Types Summary

| Use Case | Redis Type | Example Key | Why This Type? |
|----------|------------|-------------|----------------|
| Task Queue | Stream | `docket:applied-ai-agent:tasks` | Ordered, persistent, consumer groups |
| Knowledge Base | Hash | `rag_doc:documentation:file:0` | Efficient for multi-field docs + vectors |
| Answers | JSON | `answer:U123-hash-thread` | Flexible schema, path-based updates |
| Memories | JSON | `memory:user:U123:long_term:id` | Complex nested data + vector search |
| Thread Tracking | String + TTL | `thread_participation:C789:ts` | Simple flag, auto-expires |
| Rate Limiting | String + TTL | `thread_rate_limit:C789:ts` | Atomic counter, auto-resets |
| Embedding Cache | String (binary) | `embedding:cache:model:hash` | Raw bytes, fast lookup |

---

## 🎯 Key Architectural Patterns

### 1. Decoupled API and Worker

```
API Container (Stateless)          Worker Container (Stateful)
┌─────────────────┐                ┌─────────────────┐
│ Handle webhooks │                │ Process tasks   │
│ Queue tasks     │                │ Run agent       │
│ Auth requests   │                │ Call tools      │
│                 │                │                 │
│ Can scale: 5+   │                │ Can scale: 1-3  │
└────────┬────────┘                └────────┬────────┘
         │                                   │
         └──────────► Redis ◄───────────────┘
                   (Communication)
```

**Benefits:**
- API responds instantly (no blocking on agent work)
- Independent scaling (more webhooks ≠ more workers)
- Fault isolation (API stays up if worker crashes)
- Graceful deployments (update worker without API downtime)

### 2. Redis as Central Hub

```
        ┌─── API (queue tasks)
        │
        ├─── Worker (process tasks)
        │
Redis ──┼─── Memory Server (store memories)
        │
        ├─── Vector Search (find docs)
        │
        └─── Cache (embeddings, intents)
```

**Benefits:**
- Single connection string
- All data in one place
- Sub-millisecond operations
- Unified backup/monitoring
- Lower operational complexity

### 3. Agent Tool Pattern

```
┌────────────────┐
│      LLM       │
│  (OpenAI/      │
│   Bedrock)     │
└───────┬────────┘
        │ "What tools do I need?"
        ▼
   ┌─────────┐
   │ Decide  │
   └────┬────┘
        │
        ├─────► search_knowledge_base() ──► Redis Vector
        │
        ├─────► web_search() ──────────────► Tavily API
        │
        └─────► search_memory() ───────────► Redis JSON
                     │
                     ▼
                Add results to conversation
                     │
                     ▼
                Loop until done
```

**Benefits:**
- Model decides which tools to use
- Iterative refinement (can call multiple tools)
- Flexible (easy to add new tools)
- Observable (see all tool calls in logs)

---

## 🚀 Why Redis Powers Everything

**One Redis Instance Handles:**
- 🔄 **Task Queue** (Redis Streams) - Durable, ordered, exactly-once delivery
- 🔍 **Vector Search** (Hashes + VECTOR type) - Sub-millisecond semantic search
- 💾 **Document Storage** (JSON) - Flexible schemas with path-based updates
- 🧠 **Session State** (Strings + TTL) - Automatic expiration
- ⏱️ **Rate Limiting** (INCR + EXPIRE) - Atomic counters
- 📊 **Analytics** (JSON + Indexes) - Queryable Q&A pairs
- 🎯 **Caching** (Strings with TTL) - Cost savings on API calls

**Performance:**
- Task Queue: <1ms to queue/dequeue
- Vector Search: 0.5-2ms for 10K documents
- Document Retrieval: 0.1-0.5ms per document
- Cache Hits: <0.1ms
- Memory Search: 1-3ms for semantic search

**Operational Benefits:**
- Single database to backup/restore
- Single connection pool to manage
- Single monitoring dashboard
- Unified data model
- Lower total cost of ownership

This architecture makes Redis the **single source of truth** for the entire application, providing simplicity, performance, and reliability at every layer.

---

## 📚 Key Code Locations

- **API Entry Point**: `app/api/main.py`
- **Worker Entry Point**: `app/worker/worker.py`
- **Agent Core Logic**: `app/agent/core.py`
- **Knowledge Base Tool**: `app/agent/tools/search_knowledge_base.py`
- **Web Search Tool**: `app/agent/tools/web_search.py`
- **Slack Tasks**: `app/agent/tasks/slack_tasks.py`
- **Redis Key Utilities**: `app/utilities/keys.py`
- **Database Configuration**: `app/utilities/database.py`
- **Task Registration**: `app/worker/task_registration.py`

---

## 🎓 Summary

Haink demonstrates a modern, production-ready AI agent architecture that:

✅ **Decouples concerns** - API handles webhooks, worker runs agents
✅ **Uses Redis for everything** - One database, many capabilities
✅ **Implements ReAct methodology** - Agent reasons and acts iteratively
✅ **Ensures data security** - User isolation in memory operations
✅ **Provides observability** - Every step is logged and trackable
✅ **Scales independently** - API and worker scale separately
✅ **Handles failures gracefully** - Retries, rate limits, timeouts

The result is a responsive, reliable AI assistant that helps teams get answers quickly while maintaining data privacy and system performance.
