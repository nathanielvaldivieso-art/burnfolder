'use strict';

const { Octokit } = require('@octokit/rest');

function getRepoConfig() {
  return {
    owner: process.env.GITHUB_REPO_OWNER || 'nathanielvaldivieso-art',
    repo: process.env.GITHUB_REPO_NAME || 'burnfolder',
    branch: process.env.GITHUB_REPO_BRANCH || 'main'
  };
}

function createOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    const err = new Error('GITHUB_TOKEN is not configured on Netlify.');
    err.code = 'GITHUB_MISSING';
    throw err;
  }
  return new Octokit({ auth: token });
}

async function getFileText(octokit, cfg, path) {
  try {
    const res = await octokit.repos.getContent({
      owner: cfg.owner,
      repo: cfg.repo,
      path: path,
      ref: cfg.branch
    });
    if (Array.isArray(res.data) || !res.data.content) return null;
    return {
      content: Buffer.from(res.data.content, res.data.encoding || 'base64').toString('utf8'),
      sha: res.data.sha
    };
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function fileExists(octokit, cfg, path) {
  const file = await getFileText(octokit, cfg, path);
  return !!file;
}

/**
 * Commit one or more text files to main in a single commit.
 * files: [{ path, content }]
 */
  async function commitFiles(message, files) {
  const octokit = createOctokit();
  const cfg = getRepoConfig();

  const refRes = await octokit.git.getRef({
    owner: cfg.owner,
    repo: cfg.repo,
    ref: 'heads/' + cfg.branch
  });
  const parentSha = refRes.data.object.sha;

  const parentCommit = await octokit.git.getCommit({
    owner: cfg.owner,
    repo: cfg.repo,
    commit_sha: parentSha
  });

  const treeEntries = await Promise.all(
    files.map(async function (file) {
      const encoding = file.encoding || 'utf8';
      const blobContent =
        encoding === 'base64'
          ? String(file.content || '')
          : Buffer.from(String(file.content || ''), 'utf8').toString('base64');
      const blob = await octokit.git.createBlob({
        owner: cfg.owner,
        repo: cfg.repo,
        content: blobContent,
        encoding: 'base64'
      });
      return {
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.data.sha
      };
    })
  );

  const tree = await octokit.git.createTree({
    owner: cfg.owner,
    repo: cfg.repo,
    base_tree: parentCommit.data.tree.sha,
    tree: treeEntries
  });

  const commit = await octokit.git.createCommit({
    owner: cfg.owner,
    repo: cfg.repo,
    message: message,
    tree: tree.data.sha,
    parents: [parentSha]
  });

  await octokit.git.updateRef({
    owner: cfg.owner,
    repo: cfg.repo,
    ref: 'heads/' + cfg.branch,
    sha: commit.data.sha
  });

  return {
    sha: commit.data.sha,
    url: 'https://github.com/' + cfg.owner + '/' + cfg.repo + '/commit/' + commit.data.sha
  };
}

module.exports = {
  getRepoConfig: getRepoConfig,
  createOctokit: createOctokit,
  getFileText: getFileText,
  fileExists: fileExists,
  commitFiles: commitFiles
};
