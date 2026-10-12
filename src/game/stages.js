// Stage data: path label, palette, wave contents (raceCondition counts are pairs), P0 elite counts per wave and boss id.
(function (CB) {
  'use strict';
  CB.STAGES = [
    {
      id: 'src', n: 1, path: '~/src/', palette: 'src', boss: 'infiniteLoop', elites: [0, 1],
      waves: [
        [{ kind: 'syntaxError', count: 4 }, { kind: 'nullPointer', count: 2 }],
        [{ kind: 'syntaxError', count: 6 }, { kind: 'nullPointer', count: 3 }],
      ],
    },
    {
      id: 'node_modules', n: 2, path: '~/node_modules/', palette: 'node_modules', boss: 'memoryLeakBoss', elites: [0, 1],
      waves: [
        [{ kind: 'syntaxError', count: 3 }, { kind: 'raceCondition', count: 2 }, { kind: 'memoryLeak', count: 2 }],
        [{ kind: 'memoryLeak', count: 3 }, { kind: 'raceCondition', count: 2 }, { kind: 'nullPointer', count: 2 }],
      ],
    },
    {
      id: 'git', n: 3, path: '~/.git/', palette: 'git', boss: 'mergeConflict', elites: [1, 1],
      waves: [
        [{ kind: 'offByOne', count: 2 }, { kind: 'syntaxError', count: 4 }, { kind: 'raceCondition', count: 1 }],
        [{ kind: 'offByOne', count: 3 }, { kind: 'memoryLeak', count: 2 }, { kind: 'nullPointer', count: 2 }],
      ],
    },
    {
      id: 'prod', n: 4, path: '~/prod/', palette: 'prod', boss: 'heisenbug', elites: [1, 2],
      waves: [
        [{ kind: 'offByOne', count: 2 }, { kind: 'raceCondition', count: 2 }, { kind: 'memoryLeak', count: 2 }, { kind: 'nullPointer', count: 3 }],
        [{ kind: 'offByOne', count: 3 }, { kind: 'syntaxError', count: 4 }, { kind: 'memoryLeak', count: 2 }, { kind: 'raceCondition', count: 2 }],
      ],
    },
  ];
  CB.GROUP_SIZE = { raceCondition: 2 };
})(window.CB);
