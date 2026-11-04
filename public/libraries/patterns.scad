// ============================================================
// patterns.scad — Honeycomb, Grid, Perforated, Lattice
// Berguna untuk ventilasi, panel dekoratif, kisi-kisi.
// ============================================================

// Honeycomb panel (2D, siap di-extrude)
module honeycomb_2d(size = [60, 40], cell = 8, wall = 1.5) {
    w = is_list(size) ? size[0] : size;
    d = is_list(size) ? size[1] : size;
    
    h = cell * 0.866;  // sqrt(3)/2
    cols = ceil(w / (cell * 1.5)) + 1;
    rows = ceil(d / h) + 1;
    
    for (i = [0 : cols]) {
        for (j = [0 : rows]) {
            cx = i * cell * 1.5;
            cy = j * h * 2 + (i % 2) * h;
            if (cx < w + cell && cy < d + cell) {
                translate([cx, cy])
                    difference() {
                        circle(r = cell * 0.55, $fn = 6);
                        circle(r = cell * 0.55 - wall, $fn = 6);
                    }
            }
        }
    }
}

// Grid pattern (2D)
module grid_2d(size = [60, 40], cell = 5, bar = 1) {
    w = is_list(size) ? size[0] : size;
    d = is_list(size) ? size[1] : size;
    
    difference() {
        square([w, d]);
        for (x = [0 : cell : w]) {
            translate([x + bar, bar]) 
                square([cell - bar, d - 2 * bar]);
        }
    }
    // vertikal
    translate([0, 0])
    difference() {
        square([w, d]);
        for (y = [0 : cell : d]) {
            translate([bar, y + bar])
                square([w - 2 * bar, cell - bar]);
        }
    }
}

// Perforated sheet (2D) — lubang bulat merata
module perforated_2d(size = [60, 40], hole_d = 4, spacing = 8) {
    w = is_list(size) ? size[0] : size;
    d = is_list(size) ? size[1] : size;
    
    cols = floor(w / spacing);
    rows = floor(d / spacing);
    
    difference() {
        square([w, d]);
        for (i = [0 : cols]) {
            for (j = [0 : rows]) {
                translate([i * spacing + spacing / 2, j * spacing + spacing / 2])
                    circle(d = hole_d, $fn = 24);
            }
        }
    }
}

// 3D Lattice (struktur kisi-kisi)
module lattice_3d(size = [40, 40, 40], cell = 10, strut = 1.5) {
    w = is_list(size) ? size[0] : size;
    d = is_list(size) ? size[1] : size;
    h = is_list(size) ? size[2] : size;
    
    // Struts along X
    for (y = [0 : cell : d], z = [0 : cell : h])
        translate([0, y, z]) cube([w, strut, strut]);
    
    // Struts along Y
    for (x = [0 : cell : w], z = [0 : cell : h])
        translate([x, 0, z]) cube([strut, d, strut]);
    
    // Struts along Z
    for (x = [0 : cell : w], y = [0 : cell : d])
        translate([x, y, 0]) cube([strut, strut, h]);
}

// Contoh pemakaian (uncomment untuk test):
// linear_extrude(height = 3) honeycomb_2d([60, 40], 8, 1.5);