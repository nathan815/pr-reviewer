#!/usr/bin/env node
// write-feedback.js — Validates and writes feedback items to a timestamped feedback JSON file.
// The agent pipes JSON items via stdin; this script enforces the exact schema the UI expects.
//
// Usage:
//   echo '<json>' | node write-feedback.js <reviewDir>
//   node write-feedback.js <reviewDir> < items.json
//
// Stdin must be a JSON array of feedback item objects.
// Exits with code 1 and prints errors if any item fails validation.

import fs from 'fs';
import path from 'path';

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_CATEGORIES = new Set(['bug', 'security', 'performance', 'style', 'design', 'testing', 'documentation']);
const REQUIRED_FIELDS = ['id', 'file', 'startLine', 'endLine', 'commitSha', 'severity', 'category', 'title', 'comment'];

function validateItem(item, index) {
  const errors = [];
  const prefix = `items[${index}]`;

  // Check required fields exist
  for (const field of REQUIRED_FIELDS) {
    if (item[field] === undefined || item[field] === null) {
      errors.push(`${prefix}: missing required field "${field}"`);
    }
  }

  // Check no unknown/wrong field names
  if ('body' in item) errors.push(`${prefix}: use "comment" not "body"`);
  if ('line' in item) errors.push(`${prefix}: use "startLine" not "line"`);
  if ('lineNumber' in item) errors.push(`${prefix}: use "startLine" not "lineNumber"`);
  if ('description' in item) errors.push(`${prefix}: use "comment" not "description"`);
  if ('message' in item) errors.push(`${prefix}: use "comment" not "message"`);

  // Validate field values
  if (item.severity && !VALID_SEVERITIES.has(item.severity)) {
    errors.push(`${prefix}.severity: "${item.severity}" is invalid. Must be one of: ${[...VALID_SEVERITIES].join(', ')}`);
  }
  if (item.category && !VALID_CATEGORIES.has(item.category)) {
    errors.push(`${prefix}.category: "${item.category}" is invalid. Must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }
  if (item.id && (typeof item.id !== 'string' || !item.id.startsWith('f-'))) {
    errors.push(`${prefix}.id: must be a string starting with "f-"`);
  }
  if (item.startLine !== undefined && typeof item.startLine !== 'number') {
    errors.push(`${prefix}.startLine: must be a number`);
  }
  if (item.endLine !== undefined && typeof item.endLine !== 'number') {
    errors.push(`${prefix}.endLine: must be a number`);
  }

  return errors;
}

async function main() {
  const reviewDir = process.argv[2];
  if (!reviewDir) {
    console.error('Usage: node write-feedback.js <reviewDir>');
    console.error('  Pipe a JSON array of feedback items via stdin.');
    process.exit(1);
  }

  // Read stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();

  if (!raw) {
    console.error('Error: no input on stdin. Pipe a JSON array of feedback items.');
    process.exit(1);
  }

  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    console.error(`Error: invalid JSON on stdin: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(items)) {
    console.error('Error: stdin must be a JSON array of feedback items.');
    process.exit(1);
  }

  if (items.length === 0) {
    console.error('Error: empty array — nothing to write.');
    process.exit(1);
  }

  // Validate every item
  const allErrors = [];
  for (let i = 0; i < items.length; i++) {
    allErrors.push(...validateItem(items[i], i));
  }

  if (allErrors.length > 0) {
    console.error('Validation failed:');
    for (const err of allErrors) console.error(`  - ${err}`);
    process.exit(1);
  }

  // Fill defaults for optional fields
  const output = items.map(item => ({
    id: item.id,
    file: item.file,
    startLine: item.startLine,
    endLine: item.endLine,
    commitSha: item.commitSha,
    severity: item.severity,
    category: item.category,
    title: item.title,
    comment: item.comment,
    suggestion: item.suggestion || null,
    status: 'pending',
    adoThreadId: null,
  }));

  // Generate timestamped filename
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const filename = `feedback-${ts}.json`;
  const filePath = path.join(reviewDir, filename);

  // Ensure directory exists
  fs.mkdirSync(reviewDir, { recursive: true });

  // Write
  fs.writeFileSync(filePath, JSON.stringify({ items: output }, null, 2) + '\n');

  // Summary
  const sev = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const item of output) sev[item.severity]++;
  const parts = Object.entries(sev).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`);
  console.log(`Wrote ${output.length} feedback items to ${filename} (${parts.join(', ')})`);
}

main();
