// Creates the global CB namespace. Every other script attaches to it.
(function (root) {
  'use strict';
  const CB = root.CB || {};
  CB.Enemies = CB.Enemies || {};
  CB.Bosses = CB.Bosses || {};
  CB.Scenes = CB.Scenes || {};
  CB.Screens = CB.Screens || {};
  CB.W = 320;
  CB.H = 180;
  CB.DT = 1 / 60;
  CB.ARENA = Object.freeze({ x: 8, y: 20, w: 304, h: 152 });
  root.CB = CB;
})(typeof window !== 'undefined' ? window : globalThis);
