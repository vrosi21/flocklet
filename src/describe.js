// Turn a tool call into a short human label for the card's activity line.
const path = require('path');

const clip = (s, n = 70) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const base = (p) => (p ? path.basename(String(p)) : 'a file');

// Bookkeeping tools that say nothing about what the agent is actually doing.
const SILENT = new Set([
  'mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up', 'ToolSearch', 'TodoWrite',
]);

function describeTool(name, input = {}) {
  if (!name || SILENT.has(name)) return null;
  switch (name) {
    case 'Bash':
    case 'PowerShell': return clip(input.description || input.command);
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'NotebookEdit': return `Editing ${base(input.notebook_path)}`;
    case 'Grep': return clip(`Searching for "${input.pattern ?? ''}"`);
    case 'Glob': return clip(`Finding ${input.pattern ?? 'files'}`);
    case 'WebFetch':
      try { return `Reading ${new URL(input.url).hostname}`; } catch { return 'Reading a web page'; }
    case 'WebSearch': return clip(`Searching the web: ${input.query ?? ''}`);
    case 'Agent':
    case 'Task': return clip(`Subagent: ${input.description || input.subagent_type || 'working'}`);
    case 'AskUserQuestion': return 'Asking you a question';
    case 'ExitPlanMode': return 'Waiting for plan approval';
    case 'Skill': return clip(`Using skill ${input.skill ?? ''}`);
  }
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (m) return clip(`${m[2].replace(/_/g, ' ')} · ${m[1].replace(/^ccd_/, '')}`);
  return clip(name);
}

// Headline for a permission prompt: what exactly Claude wants to do.
function describePermission(name, input = {}) {
  switch (name) {
    case 'Bash':
    case 'PowerShell': return { title: `${name} command`, detail: clip(input.command, 160) };
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit': return { title: `${name} ${base(input.file_path || input.notebook_path)}`, detail: clip(input.file_path || input.notebook_path, 160) };
    case 'WebFetch': return { title: 'Fetch a web page', detail: clip(input.url, 160) };
    case 'AskUserQuestion': {
      const q = (input.questions || [])[0] || {};
      return { title: clip(q.question || 'Claude has a question', 160), detail: (q.options || []).map((o) => o.label).join(' · ') };
    }
    case 'ExitPlanMode': return { title: 'Approve the plan?', detail: clip(input.plan, 160) };
  }
  return { title: describeTool(name, input) || name, detail: clip(JSON.stringify(input), 160) };
}

module.exports = { describeTool, describePermission, clip };
