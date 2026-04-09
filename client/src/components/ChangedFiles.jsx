import { useState } from 'react';

export default function ChangedFiles({ files, feedbackItems, activeFile, onFileClick }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!files || files.length === 0) return null;

  // Build tree structure from flat file paths
  const tree = buildTree(files, feedbackItems);

  return (
    <div className="changed-files">
      <div className="changed-files-header" onClick={() => setCollapsed(!collapsed)}>
        <span>{collapsed ? '▶' : '▼'} Changed Files ({files.length})</span>
      </div>
      {!collapsed && (
        <div className="changed-files-tree">
          {tree.map((node, i) => (
            <TreeNode
              key={i}
              node={node}
              activeFile={activeFile}
              onFileClick={onFileClick}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeNode({ node, activeFile, onFileClick, depth }) {
  const [open, setOpen] = useState(true);

  if (node.children) {
    return (
      <div>
        <div
          className="file-tree-dir"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setOpen(!open)}
        >
          <span className="file-tree-arrow">{open ? '▾' : '▸'}</span>
          <span className="file-tree-icon">📁</span>
          <span>{node.name}</span>
        </div>
        {open && node.children.map((child, i) => (
          <TreeNode key={i} node={child} activeFile={activeFile} onFileClick={onFileClick} depth={depth + 1} />
        ))}
      </div>
    );
  }

  const isActive = activeFile === node.path;
  const count = node.feedbackCount || 0;

  return (
    <div
      className={`file-tree-file ${isActive ? 'file-tree-active' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onFileClick?.(node.path)}
    >
      <span className="file-tree-icon">{fileIcon(node.name)}</span>
      <span className="file-tree-name">{node.name}</span>
      {count > 0 && (
        <span className="file-tree-badge">{count}</span>
      )}
    </div>
  );
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    cs: '🟣', ts: '🔷', tsx: '🔷', js: '🟡', jsx: '🟡',
    py: '🐍', json: '📋', md: '📝', yaml: '⚙️', yml: '⚙️',
    xml: '📄', css: '🎨', html: '🌐', ps1: '💠', sh: '🐚',
  };
  return icons[ext] || '📄';
}

function buildTree(files, feedbackItems) {
  // Count feedback per file
  const feedbackCounts = {};
  for (const item of (feedbackItems || [])) {
    if (item.file) feedbackCounts[item.file] = (feedbackCounts[item.file] || 0) + 1;
  }

  const root = {};
  for (const filePath of files) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        // Leaf file
        if (!current[part]) {
          current[part] = { __file: true, __path: filePath, __count: feedbackCounts[filePath] || 0 };
        }
      } else {
        if (!current[part]) current[part] = {};
        current = current[part];
      }
    }
  }

  return treeToNodes(root);
}

function treeToNodes(obj) {
  const dirs = [];
  const filesArr = [];

  for (const [name, value] of Object.entries(obj)) {
    if (value.__file) {
      filesArr.push({ name, path: value.__path, feedbackCount: value.__count });
    } else {
      const children = treeToNodes(value);
      // Collapse single-child directories
      if (children.length === 1 && children[0].children) {
        dirs.push({ name: name + '/' + children[0].name, children: children[0].children });
      } else {
        dirs.push({ name, children });
      }
    }
  }

  // Sort: dirs first, then files
  return [...dirs.sort((a, b) => a.name.localeCompare(b.name)), ...filesArr.sort((a, b) => a.name.localeCompare(b.name))];
}
