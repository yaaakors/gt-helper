'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('api', {
  info: call('app:info'),
  chat: { history: call('chat:history'), send: call('chat:send'), execute: call('chat:execute'), cancel: call('chat:cancel'), clear: call('chat:clear'), feedback: call('chat:feedback') },
  tasks: { list: call('tasks:list'), add: call('tasks:add'), toggle: call('tasks:toggle'), edit: call('tasks:edit'), remove: call('tasks:remove'), report: call('tasks:report'), exportXlsx: call('tasks:export') },
  journal: { list: call('journal:list'), add: call('journal:add'), open: call('journal:open') },
  settings: { get: call('settings:get'), set: call('settings:set'), pick: call('settings:pick'), checkAi: call('settings:checkAi'), clearKey: call('settings:clearKey') },
  gsScript: call('gs:script'),
  copy: call('clipboard:write'), open: call('shell:open'),
  update: { check: call('update:check'), download: call('update:download'), install: call('update:install'), on: (fn) => ipcRenderer.on('update', (_e, s) => fn(s)) },
});
