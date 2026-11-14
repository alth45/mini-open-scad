/**
 * Snippet Library — 18 template siap pakai.
 * Beberapa snippet memakai bundled libraries (gears.scad, joints.scad, dll).
 * Semua bisa langsung di-render tanpa setup tambahan.
 */
export const SNIPPETS = [
  /* ==================== PRIMITIVES ==================== */
  {
    id: "rounded_cube",
    name: "Rounded Cube",
    category: "Primitives",
    icon: "▢",
    description: "Kubus dengan sudut membulat (minkowski + sphere)",
    code: `// Rounded Cube — sudut membulat, semua tepi
// Ukuran & radius bisa diubah

size   = [40, 30, 20];
radius = 3;

$fn = 32;

module rounded_cube(size, radius, center = false) {
    x = size[0] - 2 * radius;
    y = size[1] - 2 * radius;
    z = size[2] - 2 * radius;
    off = center ? [-size[0]/2, -size[1]/2, -size[2]/2] : [0, 0, 0];
    translate([off[0] + radius, off[1] + radius, off[2] + radius])
        minkowski() {
            cube([x, y, z]);
            sphere(r = radius);
        }
}

rounded_cube(size, radius, center = true);
`,
  },
  {
    id: "chamfered_box",
    name: "Chamfered Box",
    category: "Primitives",
    icon: "◈",
    description: "Kotak dengan tepi 45° (chamfer) — print tanpa overhang tajam",
    code: `// Chamfered Box — semua tepi 45°
// Cocok untuk enclosure, print tanpa overhang tajam

size    = [40, 40, 40];
chamfer = 3;

$fn = 24;

module chamfered_box(size, chamfer, center = false) {
    c = chamfer;
    off = center ? [-size[0]/2, -size[1]/2, -size[2]/2] : [0, 0, 0];
    translate(off)
        minkowski() {
            cube([size[0]-2*c, size[1]-2*c, size[2]-2*c]);
            polyhedron(
                points = [
                    [ c, 0, 0], [-c, 0, 0],
                    [ 0, c, 0], [ 0,-c, 0],
                    [ 0, 0, c], [ 0, 0,-c]
                ],
                faces = [
                    [0,2,4],[2,1,4],[1,3,4],[3,0,4],
                    [0,5,2],[2,5,1],[1,5,3],[3,5,0]
                ]
            );
        }
}

chamfered_box(size, chamfer, center = true);
`,
  },
  {
    id: "capsule",
    name: "Capsule / Pill",
    category: "Primitives",
    icon: "◯",
    description: "Silinder dengan ujung setengah bola",
    code: `// Capsule / Pill — silinder dengan ujung setengah bola
// Berguna untuk pin, handle, dsb.

length = 30;
radius = 8;
axis   = "z";  // "x" | "y" | "z"

$fn = 32;

module capsule(length, radius, axis = "z") {
    rotate([axis == "x" ? 0 : 90,
            axis == "y" ? 90 : 0,
            0]) {
        translate([0, 0, length/2])
            cylinder(h = length, r = radius, center = true);
        translate([0, 0, length])
            sphere(r = radius);
        sphere(r = radius);
    }
}

capsule(length, radius, axis);
`,
  },
  {
    id: "rounded_cylinder",
    name: "Rounded Cylinder",
    category: "Primitives",
    icon: "⬭",
    description: "Silinder dengan tepi atas/bawah membulat",
    code: `// Rounded Cylinder — silinder dengan round di atas & bawah
// Hasil print lebih halus, tanpa tepi tajam

diameter = 30;
height   = 20;
edge     = 3;

$fn = 32;

module rounded_cylinder(diameter, height, edge, center = false) {
    r = diameter / 2;
    h = height - 2 * edge;
    off = center ? -height/2 : 0;
    translate([0, 0, off])
        minkowski() {
            cylinder(h = h, r = r - edge, center = false);
            sphere(r = edge);
        }
}

rounded_cylinder(diameter, height, edge, center = true);
`,
  },

  /* ==================== MECHANICAL ==================== */
  {
    id: "spur_gear",
    name: "Spur Gear",
    category: "Mechanical",
    icon: "⚙",
    description: "Gear dengan profil involute (bundled: gears.scad)",
    code: `// Spur Gear — menggunakan bundled gears.scad
// Reference: gear(number_of_teeth, circular_pitch, ...)

use <gears.scad>;

teeth          = 20;
circular_pitch = 5;
thickness      = 8;

gear(number_of_teeth = teeth,
     circular_pitch  = circular_pitch,
     thickness       = thickness);
`,
  },
  {
    id: "metric_bolt",
    name: "Metric Bolt",
    category: "Mechanical",
    icon: "🔩",
    description: "Baut metrik dengan ulir (bundled: threads.scad)",
    code: `// Metric Bolt — baut dengan ulir (threads.scad)
// Sesuaikan length & diameter untuk M3, M4, M5, dst.

use <threads.scad>;

length   = 20;
diameter = 6;    // M6
pitch    = 1;

metric_bolt(length = length,
            diameter = diameter,
            pitch    = pitch);
`,
  },
  {
    id: "hex_nut",
    name: "Hex Nut",
    category: "Mechanical",
    icon: "⬡",
    description: "Mur segi enam untuk baut metrik",
    code: `// Hex Nut — mur segi-enam standard

nut_size  = 10;
hole_d    = 6;
thickness = 5;

$fn = 6;

difference() {
    cylinder(h = thickness, r = nut_size/2, $fn = 6);
    translate([0, 0, -0.1])
        cylinder(h = thickness + 0.2, d = hole_d, $fn = 32);
}
`,
  },

  /* ==================== ENCLOSURE ==================== */
  {
    id: "hollow_box",
    name: "Hollow Box",
    category: "Enclosure",
    icon: "📦",
    description: "Box berongga tanpa tutup (enclosure dasar)",
    code: `// Hollow Box — enclosure dasar tanpa tutup

width  = 60;
depth  = 40;
height = 25;
wall   = 2;
bottom = 2;

$fn = 32;

difference() {
    cube([width, depth, height]);
    translate([wall, wall, bottom])
        cube([width - 2*wall, depth - 2*wall, height]);
}
`,
  },
  {
    id: "pcb_standoff",
    name: "PCB Standoff",
    category: "Enclosure",
    icon: "🔧",
    description: "Dudukan PCB dengan lubang sekrup (bundled: enclosure.scad)",
    code: `// PCB Standoff — dudukan PCB dengan lubang sekrup

use <enclosure.scad>;

height  = 5;
outer_d = 6;
hole_d  = 3;

// Satu standoff
pcb_standoff(height = height, outer_d = outer_d, hole_d = hole_d);

// Contoh 4 posisi standoff PCB 58×49:
// for (p = [[3.5,3.5],[54.5,3.5],[3.5,45.5],[54.5,45.5]]) {
//     translate([p[0], p[1], 0]) pcb_standoff(height, outer_d, hole_d);
// }
`,
  },
  {
    id: "vent_slots",
    name: "Vent Slots",
    category: "Enclosure",
    icon: "▤",
    description: "Grid ventilasi untuk enclosure",
    code: `// Vent Slots — grid ventilasi untuk box enclosure
// Pakai sebagai child difference() pada permukaan box

slot_w = 4;
slot_h = 20;
gap    = 3;
count  = 5;
depth  = 2;

$fn = 16;

difference() {
    cube([60, 1, 30]);
    translate([10, -0.1, 5]) {
        for (i = [0 : count - 1]) {
            translate([i * (slot_w + gap), 0, 0])
                cube([slot_w, depth + 0.2, slot_h]);
        }
    }
}
`,
  },

  /* ==================== JOINTS ==================== */
  {
    id: "snap_fit",
    name: "Snap-fit Clip",
    category: "Joints",
    icon: "⤵",
    description: "Cantilever snap untuk enclosure (bundled: joints.scad)",
    code: `// Snap-fit Clip — cantilever snap untuk enclosure
// Tekan, kait, tahan. Tidak butuh sekrup.

use <joints.scad>;

length      = 15;
width       = 4;
height      = 10;
hook_depth  = 3;
hook_height = 2;

snap_fit_clip(length, width, height, hook_depth, hook_height);
`,
  },
  {
    id: "dovetail",
    name: "Dovetail Joint",
    category: "Joints",
    icon: "⋈",
    description: "Sambungan dovetail (male) — geser masuk, tahan tarikan",
    code: `// Dovetail — sambungan ekor burung (male)
// Geser masuk, tahan tarikan aksial.

length = 20;
width  = 10;
height = 5;
angle  = 15;

$fn = 32;

module dovetail_male(length, width, height, angle) {
    w_t = width;
    w_b = width + 2 * height * tan(angle);
    polyhedron(
        points = [
            [0,      -w_b/2, 0], [0,      w_b/2, 0],
            [0,      -w_t/2, height], [0, w_t/2, height],
            [length, -w_b/2, 0], [length, w_b/2, 0],
            [length, -w_t/2, height], [length, w_t/2, height]
        ],
        faces = [
            [0,1,5,4], [2,6,7,3], [0,4,6,2],
            [1,3,7,5], [0,2,3,1], [4,5,7,6]
        ]
    );
}

dovetail_male(length, width, height, angle);
`,
  },
  {
    id: "ball_socket",
    name: "Ball & Socket",
    category: "Joints",
    icon: "◉",
    description: "Sambungan universal (bundled: joints.scad)",
    code: `// Ball & Socket — sambungan universal (rotasi bebas)
// Cocok untuk tripod head, robot joint, dsb.

use <joints.scad>;

ball_d    = 8;
clearance = 0.5;
angle     = 120;

ball_socket(ball_d, clearance, angle);
`,
  },

  /* ==================== TEXT ==================== */
  {
    id: "text_3d",
    name: "3D Text",
    category: "Text",
    icon: "T",
    description: "Teks 3D extruded dengan parameter",
    code: `// 3D Text — teks extruded, siap dicetak

text_str = "HELLO";
size     = 20;
depth    = 3;
font     = "helvetiker:bold";
halign   = "center";

$fn = 24;

linear_extrude(height = depth)
    text(text_str,
         size   = size,
         font   = font,
         halign = halign,
         valign = "center");
`,
  },
  {
    id: "label_plate",
    name: "Label Plate",
    category: "Text",
    icon: "▭",
    description: "Plat dengan text embossed (bundled: text_tools.scad)",
    code: `// Label Plate — plat dengan text timbul
// Cocok untuk nameplate, label box, panel.

use <text_tools.scad>;

text_str = "LABEL";
size     = 12;

label_box(text_str, [40, 20, 3], size);
`,
  },

  /* ==================== PATTERNS ==================== */
  {
    id: "honeycomb",
    name: "Honeycomb Plate",
    category: "Patterns",
    icon: "⬡",
    description: "Plat dengan pola sarang lebah (bundled: patterns.scad)",
    code: `// Honeycomb Plate — plat dengan pola hexagonal
// Ringan, kuat, dan estetik.

use <patterns.scad>;

plate_size = [80, 60];
hex_radius = 5;
wall       = 1.5;
thickness  = 3;

linear_extrude(height = thickness)
    honeycomb_2d(plate_size, hex_radius, wall);
`,
  },
  {
    id: "lattice",
    name: "Lattice Cube",
    category: "Patterns",
    icon: "▦",
    description: "Kubus dengan lattice 3D (bundled: patterns.scad)",
    code: `// Lattice Cube — struktur lattice 3D ringan
// Untuk display, art, atau part dengan aliran udara.

use <patterns.scad>;

size      = [40, 40, 40];
cell_size = 10;
strut     = 1.5;

lattice_3d(size, cell_size, strut);
`,
  },
  {
    id: "perforated_plate",
    name: "Perforated Plate",
    category: "Patterns",
    icon: "▩",
    description: "Plat dengan lubang grid (bundled: patterns.scad)",
    code: `// Perforated Plate — plat dengan grid lubang
// Speaker grill, filter, atau decorative panel.

use <patterns.scad>;

plate_size = [60, 40];
hole_d     = 4;
pitch      = 8;
thickness  = 2;

linear_extrude(height = thickness)
    perforated_2d(plate_size, hole_d, pitch);
`,
  },
];
