/* ==========================================================================
   lab-runtimes.js — the single source of truth for what /labs can run.
   --------------------------------------------------------------------------
   Loaded by the page (to build the picker, the starter program and the meta
   strip) and by lab-worker.js (which only reads `mode`). Adding a language
   means adding an entry here plus a branch in lab-worker.js — nothing else
   in the UI needs to change.

   Fields
     name    display name
     slug    URL segment under /labs/ — must match the .html filename
     engine  what actually runs it, shown to the user verbatim. Be honest
             here: people picking an online compiler care whether it is the
             real interpreter or a reimplementation.
     size    approximate first-run download, human readable. Cached after.
     prism   Prism grammar id used for highlighting
     mode    'worker' -> lab-worker.js | 'jsblob' -> blob Worker (see lab-app)
     stdin   whether the Input panel means anything for this language
     sample  starter program — deliberately small and runnable as-is
   ========================================================================== */

(function (root) {
  'use strict';

  var R = {
    javascript: {
      name: 'JavaScript',
      slug: 'javascript',
      pageTitle: 'Online JavaScript Compiler — Free | Krunalkumar Shah',
      engine: 'Your browser’s own JS engine, in a Web Worker',
      size: '0 KB',
      year: 1995,
      bytes: 0,
      prism: 'javascript',
      mode: 'jsblob',
      stdin: true,
      sample: [
        '// JavaScript runs natively here — there is nothing to download.',
        '// Whatever you type in the Input panel arrives as `stdin`.',
        '',
        'const rows = [',
        '  { lang: "JavaScript", year: 1995 },',
        '  { lang: "Python",     year: 1991 },',
        '  { lang: "Lua",        year: 1993 },',
        '];',
        '',
        'for (const row of rows.sort((a, b) => a.year - b.year)) {',
        '  console.log(row.year + "  " + row.lang);',
        '}',
        '',
        'const name = stdin.trim() || "world";',
        'console.log("\\nHello, " + name + "!");'
      ].join('\n')
    },

    typescript: {
      name: 'TypeScript',
      slug: 'typescript',
      pageTitle: 'Online TypeScript Compiler — Real tsc | Krunalkumar Shah',
      engine: 'The official TypeScript compiler, then your browser’s JS engine',
      size: '~2 MB',
      year: 2012,
      bytes: 9558452,
      prism: 'typescript',
      mode: 'jsblob',
      stdin: true,
      sample: [
        '// Compiled by the real tsc, then run in a Web Worker.',
        '// Type errors are reported before anything executes.',
        '',
        'interface Repo {',
        '  name: string;',
        '  stars: number;',
        '}',
        '',
        'const repos: Repo[] = [',
        '  { name: "pyodide", stars: 13000 },',
        '  { name: "v86",     stars: 20000 },',
        '];',
        '',
        'const top = repos.reduce((a, b) => (a.stars > b.stars ? a : b));',
        'console.log("Most starred: " + top.name + " (" + top.stars + ")");'
      ].join('\n')
    },

    python: {
      name: 'Python',
      slug: 'python',
      pageTitle: 'Online Python Compiler — Real CPython | Krunalkumar Shah',
      engine: 'Real CPython compiled to WebAssembly (Pyodide)',
      size: '~6 MB',
      year: 1991,
      bytes: 12262929,
      prism: 'python',
      mode: 'worker',
      stdin: true,
      sample: [
        '# This is genuine CPython, not a reimplementation.',
        '# The standard library is available; pip install is not.',
        '',
        'import sys',
        'from collections import Counter',
        '',
        'print("Python", sys.version.split()[0])',
        '',
        'text = "the quick brown fox jumps over the lazy dog the fox"',
        'for word, n in Counter(text.split()).most_common(3):',
        '    print(n, "x", word)',
        '',
        '# input() reads from the Input panel below.',
        'name = input("Your name: ").strip() or "world"',
        'print("Hello,", name + "!")'
      ].join('\n')
    },



    c: {
      name: 'C',
      slug: 'c',
      pageTitle: 'Online C Compiler — Real clang, Free | Krunalkumar Shah',
      engine: 'Real clang compiled to WebAssembly, linked with lld',
      size: '~58 MB',
      year: 1972,
      bytes: 60373055,
      prism: 'c',
      mode: 'worker',
      stdin: true,
      sample: [
        '/* A real clang, not an interpreter. Compiled with -x c, linked',
        '   against a genuine libc, then run. structs and malloc included. */',
        '',
        '#include <stdio.h>',
        '#include <stdlib.h>',
        '#include <string.h>',
        '',
        'typedef struct {',
        '    char name[32];',
        '    int  marks;',
        '} Student;',
        '',
        'int main(void) {',
        '    Student *class = malloc(3 * sizeof(Student));',
        '    strcpy(class[0].name, "Asha");   class[0].marks = 91;',
        '    strcpy(class[1].name, "Ben");    class[1].marks = 78;',
        '    strcpy(class[2].name, "Chitra"); class[2].marks = 84;',
        '',
        '    int total = 0;',
        '    for (int i = 0; i < 3; i++) {',
        '        printf("%-8s %3d\\n", class[i].name, class[i].marks);',
        '        total += class[i].marks;',
        '    }',
        '    printf("average  %5.1f\\n", total / 3.0);',
        '',
        '    free(class);',
        '    return 0;',
        '}'
      ].join('\n')
    },

    cpp: {
      name: 'C++',
      slug: 'cpp',
      pageTitle: 'Online C++ Compiler — Real clang & STL | Krunalkumar Shah',
      engine: 'Real clang and libc++ compiled to WebAssembly',
      size: '~58 MB',
      year: 1985,
      bytes: 60373055,
      prism: 'cpp',
      mode: 'worker',
      stdin: true,
      sample: [
        '// A real clang with the real libc++, so the whole STL is here:',
        '// <vector>, <string>, <algorithm>, templates, lambdas, classes.',
        '',
        '#include <iostream>',
        '#include <vector>',
        '#include <string>',
        '#include <algorithm>',
        '',
        'struct Student {',
        '    std::string name;',
        '    int marks;',
        '};',
        '',
        'int main() {',
        '    std::vector<Student> students = {',
        '        {"Asha", 91}, {"Ben", 78}, {"Chitra", 84}, {"Dev", 66}',
        '    };',
        '',
        '    std::sort(students.begin(), students.end(),',
        '              [](const Student &a, const Student &b) {',
        '                  return a.marks > b.marks;',
        '              });',
        '',
        '    for (const auto &s : students) {',
        '        std::cout << s.name << "  " << s.marks << std::endl;',
        '    }',
        '',
        '    int total = 0;',
        '    for (const auto &s : students) total += s.marks;',
        '    std::cout << "average " << (total / (double)students.size()) << std::endl;',
        '    return 0;',
        '}'
      ].join('\n')
    },

    sql: {
      name: 'SQL',
      slug: 'sql',
      pageTitle: 'Online SQL Compiler — Practise SQLite | Krunalkumar Shah',
      engine: 'Real SQLite compiled to WebAssembly (sql.js)',
      size: '~700 KB',
      year: 1974,
      bytes: 708594,
      prism: 'sql',
      mode: 'worker',
      stdin: false,
      sample: [
        '-- A real SQLite engine, held in memory. The database is created',
        '-- fresh on every run, so the schema is part of the script.',
        '',
        'CREATE TABLE employee (',
        '  id     INTEGER PRIMARY KEY,',
        '  name   TEXT    NOT NULL,',
        '  dept   TEXT    NOT NULL,',
        '  salary INTEGER NOT NULL',
        ');',
        '',
        'INSERT INTO employee (name, dept, salary) VALUES',
        '  ("Asha",   "Engineering", 92000),',
        '  ("Ben",    "Engineering", 78000),',
        '  ("Chitra", "Design",      71000),',
        '  ("Dev",    "Sales",       64000),',
        '  ("Eli",    "Design",      83000);',
        '',
        'SELECT dept,',
        '       COUNT(*)           AS headcount,',
        '       ROUND(AVG(salary)) AS avg_salary',
        'FROM employee',
        'GROUP BY dept',
        'ORDER BY avg_salary DESC;'
      ].join('\n')
    },

    lua: {
      name: 'Lua',
      slug: 'lua',
      pageTitle: 'Online Lua Compiler — Real Lua 5.4 | Krunalkumar Shah',
      engine: 'Real Lua 5.4 compiled to WebAssembly (Wasmoon)',
      size: '~420 KB',
      year: 1993,
      bytes: 423233,
      prism: 'lua',
      mode: 'worker',
      stdin: true,
      sample: [
        '-- Genuine Lua 5.4. io.read() reads from the Input panel below.',
        '',
        'local function fib(n)',
        '  local a, b = 0, 1',
        '  for _ = 1, n do a, b = b, a + b end',
        '  return a',
        'end',
        '',
        'for i = 1, 10 do',
        '  io.write(fib(i), " ")',
        'end',
        'print()',
        '',
        'local name = io.read()',
        'if name == nil or name == "" then name = "world" end',
        'print("Hello, " .. name .. "!")'
      ].join('\n')
    },

    postgres: {
      name: 'PostgreSQL',
      slug: 'postgres',
      pageTitle: 'Online PostgreSQL Editor — Real Postgres | Krunalkumar Shah',
      engine: 'Real PostgreSQL compiled to WebAssembly (PGlite)',
      size: '~17 MB',
      bytes: 16844056,
      year: 1996,
      prism: 'sql',
      mode: 'worker',
      stdin: false,
      sample: [
        '-- A real PostgreSQL server, running in this tab. Not a',
        '-- Postgres-compatible engine: the actual thing, so the dialect,',
        '-- the types and the error messages all match a real install.',
        '',
        'CREATE TABLE employee (',
        '  id     SERIAL PRIMARY KEY,',
        '  name   TEXT    NOT NULL,',
        '  dept   TEXT    NOT NULL,',
        '  salary NUMERIC NOT NULL',
        ');',
        '',
        'INSERT INTO employee (name, dept, salary) VALUES',
        '  (\'Asha\', \'Engineering\', 92000),',
        '  (\'Ben\', \'Engineering\', 78000),',
        '  (\'Chitra\', \'Design\', 71000),',
        '  (\'Dev\', \'Sales\', 64000),',
        '  (\'Eli\', \'Design\', 83000);',
        '',
        '-- Window functions, CTEs and string aggregation are genuinely here.',
        'SELECT dept,',
        '       COUNT(*)           AS headcount,',
        '       ROUND(AVG(salary)) AS avg_salary,',
        '       STRING_AGG(name, \', \' ORDER BY name) AS people',
        'FROM employee',
        'GROUP BY dept',
        'ORDER BY avg_salary DESC;'
      ].join('\n')
    },

    ruby: {
      name: 'Ruby',
      slug: 'ruby',
      pageTitle: 'Online Ruby Compiler — Real CRuby | Krunalkumar Shah',
      engine: 'Real CRuby compiled to WebAssembly (ruby.wasm)',
      size: '~17 MB',
      bytes: 16822206,
      year: 1995,
      prism: 'ruby',
      mode: 'worker',
      stdin: false,
      sample: [
        '# Genuine CRuby, from the Ruby core team, compiled to WebAssembly.',
        '',
        'Student = Struct.new(:name, :marks) do',
        '  def grade',
        '    case marks',
        '    when 90..     then \'A\'',
        '    when 75...90  then \'B\'',
        '    else \'C\'',
        '    end',
        '  end',
        'end',
        '',
        'students = [',
        '  Student.new(\'Asha\', 91),',
        '  Student.new(\'Ben\', 78),',
        '  Student.new(\'Chitra\', 64)',
        ']',
        '',
        'students.sort_by { |s| -s.marks }.each do |s|',
        '  puts format(\'%-8s %3d  %s\', s.name, s.marks, s.grade)',
        'end',
        '',
        'puts',
        'puts "average #{students.sum(&:marks) / students.size.to_f}"'
      ].join('\n')
    },

    perl: {
      name: 'Perl',
      slug: 'perl',
      pageTitle: 'Online Perl Compiler — Real Perl 5 | Krunalkumar Shah',
      engine: 'Real Perl 5 compiled to WebAssembly (WebPerl)',
      size: '~16 MB',
      bytes: 16073263,
      year: 1987,
      prism: 'perl',
      mode: 'worker',
      stdin: false,
      sample: [
        '# Real Perl 5. Regular expressions are why people still reach for it,',
        '# so here they are doing what they do best.',
        '',
        'use strict;',
        'use warnings;',
        '',
        'my $text = "Asha:91 Ben:78 Chitra:64 Dev:88";',
        '',
        'my %marks;',
        'while ($text =~ /(\\w+):(\\d+)/g) {',
        '    $marks{$1} = $2;',
        '}',
        '',
        'for my $name (sort { $marks{$b} <=> $marks{$a} } keys %marks) {',
        '    printf "%-8s %3d\\n", $name, $marks{$name};',
        '}',
        '',
        'my $total = 0;',
        '$total += $_ for values %marks;',
        'printf "\\naverage %.1f\\n", $total / scalar(keys %marks);'
      ].join('\n')
    },

    php: {
      name: 'PHP',
      slug: 'php',
      pageTitle: 'Online PHP Compiler — Real PHP 8.4 | Krunalkumar Shah',
      engine: 'Real PHP 8.4 compiled to WebAssembly',
      size: '~14 MB',
      bytes: 14210763,
      year: 1994,
      prism: 'php',
      mode: 'worker',
      stdin: false,
      sample: [
        '<?php',
        '// Real PHP 8.4. The opening tag is optional here - it is added for',
        '// you if you leave it out.',
        '',
        '$students = [',
        '    [\'name\' => \'Asha\',   \'marks\' => 91],',
        '    [\'name\' => \'Ben\',    \'marks\' => 78],',
        '    [\'name\' => \'Chitra\', \'marks\' => 64],',
        '];',
        '',
        'usort($students, fn($a, $b) => $b[\'marks\'] <=> $a[\'marks\']);',
        '',
        'foreach ($students as $s) {',
        '    printf("%-8s %3d%s", $s[\'name\'], $s[\'marks\'], PHP_EOL);',
        '}',
        '',
        '$avg = array_sum(array_column($students, \'marks\')) / count($students);',
        'echo PHP_EOL, "average ", number_format($avg, 1), PHP_EOL;'
      ].join('\n')
    },

  };

  // Ordered by the year each language first appeared, so the picker and the
  // hub read as a timeline rather than an unexplained list. Every entry
  // carries its year and the cards show it.
  // C and C++ run a real clang + lld toolchain (~58 MB, fetched on first Run
  // only). An earlier attempt used the JSCPP interpreter and was pulled: it
  // could not compile struct, enum, class, std::string or std::vector, which
  // is too little to honestly call a C or C++ compiler.
  var ORDER = [
    'c',
    'sql',
    'cpp',
    'perl',
    'python',
    'lua',
    'php',
    'javascript',
    'ruby',
    'postgres',
    'typescript'
  ];

  root.LAB_RUNTIMES = R;
  root.LAB_ORDER = ORDER;
  root.LAB_LIST = ORDER.map(function (id) {
    R[id].id = id;
    return R[id];
  });
})(typeof self !== 'undefined' ? self : this);
