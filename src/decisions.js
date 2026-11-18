// Builds PermissionRequest hook replies from a click in the panel.
// Pure functions: the renderer only sends an intent ({type, index, answers...});
// everything Claude receives is built here from the ORIGINAL hook payload.
const { clip } = require('./describe');

const WHERE = {
  session: 'this session',
  localSettings: 'this project (only you)',
  projectSettings: 'this project (shared)',
  userSettings: 'all projects',
};

function ruleText(r) {
  return r.ruleContent ? `${r.toolName}(${clip(r.ruleContent, 60)})` : r.toolName;
}

// "Always allow" options Claude Code itself offered for this prompt.
function permissionSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  const out = [];
  suggestions.forEach((s, index) => {
    if (!s || typeof s !== 'object') return;
    const where = WHERE[s.destination] || s.destination || 'this session';
    let label = null;
    if ((s.type === 'addRules' || s.type === 'replaceRules') && s.behavior !== 'deny' && s.behavior !== 'ask' && Array.isArray(s.rules)) {
      label = `Always allow ${s.rules.map(ruleText).join(', ')} · ${where}`;
    } else if (s.type === 'addDirectories' && Array.isArray(s.directories)) {
      label = `Allow access to ${s.directories.map((d) => clip(d, 50)).join(', ')} · ${where}`;
    } else if (s.type === 'setMode' && s.mode && s.mode !== 'bypassPermissions') {
      label = `Allow and switch this session to ${s.mode} mode`;
    }
    if (label) out.push({ index, label });
  });
  return out;
}

// AskUserQuestion questions, trimmed to what the panel needs.
function questionsOf(toolInput) {
  const qs = toolInput && Array.isArray(toolInput.questions) ? toolInput.questions : [];
  return qs.map((q) => ({
    question: String(q.question ?? ''),
    header: String(q.header ?? ''),
    multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).map((o) => ({
      label: String(o.label ?? ''), description: String(o.description ?? ''),
    })),
  }));
}

const out = (decision) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });

function buildDecision(ev, action) {
  if (!action || typeof action !== 'object') throw new Error('no action');
  switch (action.type) {
    case 'allow':
      return out({ behavior: 'allow' });

    case 'always': {
      const offered = permissionSuggestions(ev.permission_suggestions);
      if (!offered.some((s) => s.index === action.index)) throw new Error('unknown suggestion');
      return out({ behavior: 'allow', updatedPermissions: [ev.permission_suggestions[action.index]] });
    }

    case 'deny': {
      const reason = typeof action.reason === 'string' ? action.reason.trim().slice(0, 2000) : '';
      return out({ behavior: 'deny', message: reason || 'The user denied this from Flocklet.' });
    }

    case 'answer': {
      if (ev.tool_name !== 'AskUserQuestion') throw new Error('not a question');
      const questions = questionsOf(ev.tool_input);
      if (!Array.isArray(action.answers) || action.answers.length !== questions.length) throw new Error('answer count');
      const answers = {};
      questions.forEach((q, i) => {
        const a = action.answers[i] || {};
        const labels = Array.isArray(a.labels) ? a.labels.filter((l) => typeof l === 'string') : [];
        const valid = new Set(q.options.map((o) => o.label));
        if (labels.some((l) => !valid.has(l))) throw new Error('unknown option');
        const other = typeof a.other === 'string' ? a.other.trim().slice(0, 2000) : '';
        const picked = [...new Set(labels)];
        if (other) picked.push(other);
        if (!picked.length) throw new Error('unanswered question');
        if (!q.multiSelect && picked.length !== 1) throw new Error('single-select question');
        answers[q.question] = picked.join(', ');
      });
      // updatedInput replaces the whole input, so keep the original questions alongside the answers.
      return out({ behavior: 'allow', updatedInput: { ...ev.tool_input, answers } });
    }
  }
  throw new Error(`unknown action ${action.type}`);
}

module.exports = { permissionSuggestions, questionsOf, buildDecision };
