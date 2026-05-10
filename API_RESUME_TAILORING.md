# Resume Tailoring API - Usage Guide

## Quick Start

### 1. Set up a test user with a resume

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "resume_text": "JOHN DOE\nTechCorp Inc., Senior Backend Engineer (2022-Present)\n• Designed microservices architecture\n• Optimized database queries\n• Led REST API development\n..."
  }'
```

Response:
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "resume_text": "...",
  "created_at": "2026-05-06 10:30:00",
  "updated_at": "2026-05-06 10:30:00"
}
```

### 2. Tailor resume to a job

```bash
curl -X POST http://localhost:3000/api/resumes/tailor \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "jobUrl": "https://boards.greenhouse.io/example/jobs/123"
  }'
```

Response (streaming NDJSON):
```
{"type":"progress","step":1,"of":2,"message":"Analyzing job requirements..."}
{"type":"progress","step":2,"of":2,"message":"Tailored resume ready (28 bullets)","done":true}
{"type":"done","tailored_resume_id":456,"tailored_resume_text":"...","job_title":"Senior Backend Engineer","bullets_included":28,"match_score":87,"requirements":["Node.js","REST APIs","PostgreSQL","Docker","Kubernetes"],"created_at":"2026-05-06 10:35:00"}
```

### 3. Fetch tailored resume

```bash
curl http://localhost:3000/api/resumes/tailored?userId=1
```

Response:
```json
[
  {
    "id": 456,
    "user_id": 1,
    "job_url": "https://boards.greenhouse.io/example/jobs/123",
    "base_resume_text": "...",
    "tailored_resume_text": "...",
    "job_title": "Senior Backend Engineer",
    "job_requirements_json": "[\"Node.js\",\"REST APIs\",...]",
    "bullets_included": 28,
    "created_at": "2026-05-06 10:35:00",
    "updated_at": "2026-05-06 10:35:00"
  }
]
```

### 4. Get specific tailored resume

```bash
curl 'http://localhost:3000/api/resumes/tailored/https%3A%2F%2Fboards.greenhouse.io%2Fexample%2Fjobs%2F123?userId=1'
```

Response:
```json
{
  "id": 456,
  "user_id": 1,
  "job_url": "https://boards.greenhouse.io/example/jobs/123",
  "tailored_resume_text": "...",
  "job_title": "Senior Backend Engineer",
  ...
}
```

### 5. Delete tailored resume

```bash
curl -X DELETE 'http://localhost:3000/api/resumes/tailored/https%3A%2F%2Fboards.greenhouse.io%2Fexample%2Fjobs%2F123?userId=1'
```

Response:
```json
{"ok": true}
```

---

## Endpoint Reference

### POST /api/resumes/tailor

**Purpose**: Tailor a resume to a specific job

**Request**:
```typescript
{
  userId: number;              // Required: Job Automator user ID
  jobUrl: string;              // Required: Full URL of job posting
  jobDescription?: string;     // Optional: Job description text (scraped if omitted)
}
```

**Response** (Streaming NDJSON):

Progress event:
```typescript
{
  type: "progress";
  step: number;        // 1 or 2
  of: number;          // Total steps (usually 2)
  message: string;     // Human-readable status
  done?: boolean;      // True when this step completes
}
```

Done event:
```typescript
{
  type: "done";
  tailored_resume_id: number;
  tailored_resume_text: string;    // The tailored resume
  job_title: string;               // Extracted from job analysis
  bullets_included: number;        // Count of bullets in resume
  match_score: number;             // 0-100 job match score
  requirements: string[];          // Extracted job requirements
  created_at: string;              // ISO timestamp
}
```

Error event:
```typescript
{
  type: "error";
  message: string;     // Error description
}
```

**Status Codes**:
- `200` - Success (streaming)
- `400` - Invalid request (missing userId or jobUrl)
- `500` - Server error (scraping failed, analysis failed, etc.)

**Latency**:
- First tailor: 35-75 seconds (includes job scraping + Gemma analysis)
- Cached tailor: <100ms (direct database lookup)

**Example with curl**:
```bash
curl -X POST http://localhost:3000/api/resumes/tailor \
  -H "Content-Type: application/json" \
  -d '{"userId":1,"jobUrl":"https://example.com/job/123"}' \
  --progress-meter --show-error
```

**Example with fetch (JavaScript)**:
```javascript
const response = await fetch('http://localhost:3000/api/resumes/tailor', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 1,
    jobUrl: 'https://boards.greenhouse.io/example/jobs/123'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const lines = decoder.decode(value).split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    
    if (event.type === 'progress') {
      console.log(`Step ${event.step}/${event.of}: ${event.message}`);
    } else if (event.type === 'done') {
      console.log('Tailored resume ready:', event.tailored_resume_text);
    } else if (event.type === 'error') {
      console.error('Error:', event.message);
    }
  }
}
```

---

### GET /api/resumes/tailored

**Purpose**: List all tailored resumes for a user

**Query Parameters**:
```typescript
{
  userId: number;  // Required: Job Automator user ID
}
```

**Response**:
```typescript
[
  {
    id: number;
    user_id: number;
    job_url: string;
    base_resume_text: string;
    tailored_resume_text: string;
    job_title: string;
    job_requirements_json: string | null;
    bullets_included: number | null;
    created_at: string;
    updated_at: string;
  }
]
```

**Status Codes**:
- `200` - Success
- `400` - Missing userId parameter

**Example**:
```bash
curl 'http://localhost:3000/api/resumes/tailored?userId=1'
```

---

### GET /api/resumes/tailored/:jobUrl

**Purpose**: Fetch a specific tailored resume by job URL

**Path Parameters**:
```typescript
{
  jobUrl: string;  // URL-encoded job URL
}
```

**Query Parameters**:
```typescript
{
  userId: number;  // Required: Job Automator user ID
}
```

**Response**:
```typescript
{
  id: number;
  user_id: number;
  job_url: string;
  tailored_resume_text: string;
  job_title: string;
  bullets_included: number | null;
  created_at: string;
  updated_at: string;
}
```

**Status Codes**:
- `200` - Success
- `400` - Missing userId parameter
- `404` - Tailored resume not found

**Example**:
```bash
# URL encode the job URL: https://boards.greenhouse.io/example/jobs/123
# Becomes: https%3A%2F%2Fboards.greenhouse.io%2Fexample%2Fjobs%2F123

curl 'http://localhost:3000/api/resumes/tailored/https%3A%2F%2Fboards.greenhouse.io%2Fexample%2Fjobs%2F123?userId=1'
```

**JavaScript helper for URL encoding**:
```javascript
const jobUrl = 'https://boards.greenhouse.io/example/jobs/123';
const encodedUrl = encodeURIComponent(jobUrl);
const endpoint = `http://localhost:3000/api/resumes/tailored/${encodedUrl}?userId=1`;
const tailored = await fetch(endpoint).then(r => r.json());
```

---

### DELETE /api/resumes/tailored/:jobUrl

**Purpose**: Delete a cached tailored resume

**Path Parameters**:
```typescript
{
  jobUrl: string;  // URL-encoded job URL
}
```

**Query Parameters**:
```typescript
{
  userId: number;  // Required: Job Automator user ID
}
```

**Response**:
```json
{"ok": true}
```

**Status Codes**:
- `200` - Success (deletion completed or already didn't exist)
- `400` - Missing userId parameter

**Example**:
```bash
curl -X DELETE 'http://localhost:3000/api/resumes/tailored/https%3A%2F%2Fboards.greenhouse.io%2Fexample%2Fjobs%2F123?userId=1'
```

---

## Error Handling

### Missing User
**Request**: `{"userId": 999, "jobUrl": "..."}`
**Response**: `400 Bad Request`
```json
{"error": "User not registered"}
```

### User Has No Resume
**Request**: User 1 with empty resume_text
**Response**: `400 Bad Request`
```json
{"error": "User has no resume on file"}
```

**Solution**: Call `/api/users/sync` to update user's resume.

### Job Not Found
**Request**: `{"userId": 1, "jobUrl": "https://invalid.url"}`
**Response**: `500 Internal Server Error`
```json
{"error": "Could not fetch or parse job description"}
```

**Solution**: Verify URL is valid, try again, or provide `jobDescription` manually.

### Database Error
**Response**: `500 Internal Server Error`
```json
{"error": "Database error: ..."}
```

---

## Caching & Performance

### How Caching Works

Tailored resumes are cached by `(user_id, job_url)`. When you request the same job twice:

1. **First request**:
   - Scrapes job description (5-15 seconds)
   - Analyzes with Gemma (30-60 seconds)
   - Reorders resume bullets (<100ms)
   - Saves to `tailored_resumes` table
   - Returns to client

2. **Second request** (same user, same job):
   - Database lookup: <100ms
   - Returns cached version
   - No scraping or analysis

### Cache Invalidation

**Manual deletion**:
```bash
curl -X DELETE "http://localhost:3000/api/resumes/tailored/:jobUrl?userId=1"
```

**Automatic update** (on re-tailor):
- If job URL already exists, UPSERT overwrites the tailored_resume_text
- `updated_at` is refreshed
- All fields are updated with new analysis

### Checking Cache Status

Query the database:
```sql
sqlite3 observability.db
SELECT COUNT(*), updated_at FROM tailored_resumes WHERE user_id = 1 GROUP BY updated_at;
```

---

## NotchUp Integration

### From NotchUp (Swift/iOS)

```swift
import Foundation

class JobAutomatorClient {
    private let baseURL = "http://localhost:3000"
    
    func tailorResume(userId: Int, jobUrl: String) async throws {
        let url = URL(string: "\(baseURL)/api/resumes/tailor")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "userId": userId,
            "jobUrl": jobUrl
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.bytes(for: request)
        
        // Parse streaming NDJSON
        for try await line in data.lines {
            if let event = try JSONDecoder().decode(TailorEvent.self, from: line.data(using: .utf8)!) {
                switch event.type {
                case "progress":
                    DispatchQueue.main.async {
                        print("Progress: \(event.message ?? "")")
                    }
                case "done":
                    DispatchQueue.main.async {
                        // Display tailored resume
                        let tailored = event.tailored_resume_text ?? ""
                        self.displayTailoredResume(tailored)
                    }
                case "error":
                    throw NSError(domain: "TailorError", code: -1, userInfo: [NSLocalizedDescriptionKey: event.message ?? "Unknown error"])
                default:
                    break
                }
            }
        }
    }
}
```

---

## Rate Limiting

Currently: No rate limiting implemented

**Future**: Recommend adding:
- 10 requests per minute per user (tailor operations are expensive)
- 100 requests per hour per user (metadata queries)

---

## Monitoring & Observability

### Logging

Job Automator logs all tailor operations to SQLite:
- `analysis_inputs` table tracks job URLs analyzed
- `run_events` table tracks LLM latency and token usage

Query analysis history:
```sql
SELECT url, title, score, jd_length FROM analysis_inputs 
WHERE url LIKE '%greenhouse%' 
ORDER BY time DESC 
LIMIT 10;
```

### Metrics

Track tailoring performance:
```sql
SELECT 
  COUNT(*) as total_tailorings,
  AVG((julianday(updated_at) - julianday(created_at)) * 86400) as avg_latency_seconds,
  MAX(bullets_included) as max_bullets,
  MIN(bullets_included) as min_bullets
FROM tailored_resumes;
```

---

## Testing

Run integration tests:
```bash
cd /Users/martinez/Developer/job-automator
npx tsx tests/tailor-integration.test.ts
```

Expected output:
```
==========================================================
Resume Tailoring Integration Tests
==========================================================

--- Test: Extract Bullets ---
Extracted 17 bullets
PASS: Bullet extraction works

--- Test: Tailor Bullet Order ---
Tailored bullet order (first 5):
  ...
PASS: Bullet reordering by relevance works

--- Test: Preserve Resume Structure ---
Structure preserved:
  EXPERIENCE section: YES
  SKILLS section: YES
  ...
PASS: Resume structure preserved

--- Test: Relevance Scoring ---
...
PASS: Relevance scoring works

==========================================================
Results: 4/4 tests passed
==========================================================
All tests passed!
```

---

## Troubleshooting

### "User has no resume on file"

**Cause**: User hasn't uploaded/synced their resume.

**Solution**: 
```bash
curl -X POST http://localhost:3000/api/users/sync \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "resume_text": "full resume text here..."
  }'
```

### "Could not fetch or parse job description"

**Cause**: Job URL is invalid or page structure changed.

**Solution**: 
```bash
# Provide job description manually
curl -X POST http://localhost:3000/api/resumes/tailor \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "jobUrl": "https://example.com/job/123",
    "jobDescription": "We are hiring... [full job description]"
  }'
```

### Timeout after 60+ seconds

**Cause**: Job analysis is slow (Gemma inference takes time).

**Solution**: 
- This is normal, expected latency
- Cache will return in <100ms next time
- Consider increasing HTTP timeout in client

### Empty match_score in response

**Cause**: Analysis completed but score extraction failed.

**Solution**: Check Job Automator logs for Gemma response parsing errors.

---

## API Versioning

Current version: `v1` (implicit)

Future versions might include:
- `/api/v2/resumes/tailor` - Different response format
- `/api/v2/resumes/tailor/batch` - Bulk tailoring

For now, only current API is supported. No breaking changes planned before v2.
