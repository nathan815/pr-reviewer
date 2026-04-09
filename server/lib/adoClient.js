import fetch from 'node-fetch';
import { execSync } from 'child_process';

/**
 * ADO REST API client for posting PR comments.
 * Uses `az cli` to fetch a Bearer token (no PAT needed).
 * 
 * Requires environment variables:
 *   ADO_ORG        - Organization name (e.g., "msazure")
 *   ADO_PROJECT    - Project name (e.g., "One")
 * 
 * Requires `az login` to have been run beforehand.
 */

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const result = execSync(
    'az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query "{token:accessToken,expires:expiresOn}" -o json',
    { encoding: 'utf-8' }
  );
  const parsed = JSON.parse(result);
  cachedToken = parsed.token;
  // Expire 2 minutes early to avoid edge cases
  tokenExpiry = new Date(parsed.expires).getTime() - 120_000;
  return cachedToken;
}

function getConfig() {
  const org = process.env.ADO_ORG;
  const project = process.env.ADO_PROJECT;
  if (!org || !project) {
    throw new Error('Missing ADO_ORG or ADO_PROJECT environment variables');
  }
  return { org, project };
}

async function authHeader() {
  const token = await getAccessToken();
  return `Bearer ${token}`;
}

function apiBase(org, project) {
  return `https://dev.azure.com/${org}/${project}/_apis`;
}

/**
 * Post a comment thread to a pull request.
 * Creates an inline comment at the specified file and line range.
 */
export async function postPRComment(repoName, prId, { file, startLine, endLine, comment, suggestion }) {
  const { org, project } = getConfig();
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
      'Authorization': await authHeader(),
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
  const { org, project } = getConfig();
  const base = apiBase(org, project);
  const url = `${base}/git/repositories/${repoName}/pullRequests/${prId}?api-version=7.1`;

  const response = await fetch(url, {
    headers: { 'Authorization': await authHeader() },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ADO API error ${response.status}: ${errorText}`);
  }

  return response.json();
}
