export const CONFIG = {
  defaultFn: 0,           // 0 = "auto" — pakai $fa/$fs
  defaultFa: 12,          // maximum angle per segment (deg)
  defaultFs: 2,           // minimum arc length per segment (mm)
  fallbackFn: 32,         // dipakai saat $fa/$fs tidak applicable (no radius info)
  evalTimeoutMs: 2500,
  autoRenderDelay: 800,
  saveDelay: 500,
  maxLoopIterations: 20000,
  defaultColor: 0xf9d72c,
  storageKey: 'mini-openscad-v1'
};

export const DEFAULT_CODE = `// ===============================================
// Mini OpenSCAD — contoh: kubus berlubang
// Tekan Ctrl+Enter untuk render
// ===============================================
$fn = 64;

difference() {
    cube([30, 30, 20], center = true);
    cylinder(h = 40, r = 8, center = true);
}
`;

export const PRESETS = {
  'Cube': `// Kubus dasar
$fn = 32;
cube([20, 20, 20], center = true);
`,
  'Cylinder + Sphere': `// Silinder + bola di atasnya
$fn = 48;
cylinder(h = 30, r = 10);
translate([0, 0, 30]) sphere(r = 12);
`,
  'Difference: Cube minus Cylinder': `// Kubus berlubang (CSG difference)
$fn = 64;
difference() {
    cube([30, 30, 20], center = true);
    cylinder(h = 40, r = 8, center = true);
}
`,
  'Union: Two Cylinders': `// Dua silinder digabung (union)
$fn = 48;
union() {
    translate([-10, 0, 0]) cylinder(h = 25, r = 6);
    translate([ 10, 0, 0]) cylinder(h = 25, r = 6);
    translate([0, 0, 25]) rotate([0, 90, 0])
        cylinder(h = 20, r = 6, center = true);
}
`,
  'Linear Extrude: Gear': `// Gear sederhana (module + for + difference)
$fn = 64;

module tooth() {
    translate([16, -2.5, 0]) cube([6, 5, 6]);
}

difference() {
    union() {
        cylinder(h = 6, r = 18);
        for (i = [0 : 30 : 330]) {
            rotate([0, 0, i]) tooth();
        }
    }
    cylinder(h = 20, r = 5, center = true);
}
`,
  'For Loop: Row of Cubes': `// Grid kubus dengan tinggi bertingkat
for (i = [0 : 4]) {
    for (j = [0 : 4]) {
        translate([i * 12, j * 12, 0])
            cube([10, 10, 6 + (i + j) * 2]);
    }
}
`,
  'Rotate Extrude: Torus': `// Torus via rotate_extrude
$fn = 64;
rotate_extrude(angle = 360)
    translate([25, 0, 0]) circle(r = 8);
`,
  'Mirror + Color': `// Mirror & color
$fn = 32;
color("red") mirror([1, 0, 0])
    translate([10, 0, 0]) sphere(r = 8);

color([0.2, 0.8, 0.4]) translate([0, 0, 0])
    cylinder(h = 20, r = 4, center = true);
`
};