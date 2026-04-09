import fetch from 'node-fetch';

/**
 * ADO REST API client for posting PR comments.
 * 
 * Requires environment variables:
 *   ADO_PAT        - Personal Access Token
 *   ADO_ORG        - Organization name (e.g., "msazure")
 *   ADO_PROJECT    - Project name (e.g., "One")
 */

function getConfig() {
  const pat = process.env.ADO_PAT;
  const org = process.env.ADO_ORG;
  const project = process.env.ADO_PROJECT;
  if (!pat || !org || !project) {
    throw new Error('Missing ADO_PAT, ADO_ORG, or ADO_PROJECT environment variables');
  }
  return { pat, org, project };
}

function authHeader(pat) {
  const encoded = Buffer.from(`:${pat}`).toString('base64');
  return `Basic ${encoded}`;
}

function apiBase(org, project) {
  return `https://dev.azure.com/${org}/${project}/_apis`;
}

/**
 * Post a comment thread to a pull request.
 * Creates an inline comment at the specified file and line range.
 */
export async function postPRComment(repoName, prId, { file, startLine, endLine, comment, suggestion }) {
  const { pat, org, project } = getConfig();
  const base = apiBase(org, project);
  const url = `${base}/git/repositories/${repoName}/pullRequests/${prId}/threads?api-version=7.1`;

  // Build the comment body with suggestion if present
  let body = comment;
  if (suggestion) {
    body += `\n\n**Suggestion:**\n${suggestion}`;
  }

  const threadPayload = {
    comments: [
      {
        parentCommentId: 0,
        content: body,
        commentType: 1, // text
      }
    ],
    status: 1, // Active
  };

  // Add file/line context for inline comments
  if (file) {
    threadPayload.threadContext = {
      filePath: file.startsWith('/') ? file : `/${file}`,
      rightFileStart: { line: startLine || 1, offset: 1 },
      rightFileEnd: { line: endLine || startLine || 1, offset: 1 },
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader(pat),
    },
    body: JSON.stringify(threadPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ADO API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  return {
    threadId: result.id,
    url: `https://dev.azure.com/${org}/${project}/_git/${repoName}/pullrequest/${prId}`,
  };
}

/**
 * Get PR details from ADO (used for metadata enrichment).
 */
export async function getPRDetails(repoName, prId) {
  const { pat, org, project } = getConfig();
  const base = apiBase(org, project);
  const url = `${base}/git/repositories/${repoName}/pullRequests/${prId}?api-version=7.1`;

  const response = await fetch(url, {
    headers: { 'Authorization': authHeader(pat) },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ADO API error ${response.status}: ${errorText}`);
  }

  return response.json();
}
