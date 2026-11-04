// ============================================================
// rounded_shapes.scad — Rounded / Chamfered Shapes
// ============================================================

module rounded_cube(size = [10, 10, 10], radius = 2, center = false) {
    w = is_list(size) ? size[0] : size;
    d = is_list(size) ? size[1] : size;
    h = is_list(size) ? size[2] : size;
    
    cx = center ? -w / 2 : 0;
    cy = center ? -d / 2 : 0;
    cz = center ? -h / 2 : 0;
    
    translate([cx, cy, cz])
    hull() {
        for (x = [radius, w - radius])
            for (y = [radius, d - radius])
                for (z = [radius, h - radius])
                    translate([x, y, z]) sphere(r = radius, $fn = 24);
    }
}

module chamfered_cube(size = [10, 10, 10], chamfer = 1, center = false) {
    w = is_list(size) ? size[0] : size;
    d = is_list(size) ? size[1] : size;
    h = is_list(size) ? size[2] : size;
    
    cx = center ? -w / 2 : 0;
    cy = center ? -d / 2 : 0;
    cz = center ? -h / 2 : 0;
    
    translate([cx, cy, cz])
    difference() {
        cube([w, d, h]);
        // Cut 12 edges
        for (axis = [0, 1, 2])
            for (sign = [-1, 1])
                translate([
                    (axis == 0 ? sign * w / 2 : w / 2),
                    (axis == 1 ? sign * d / 2 : d / 2),
                    (axis == 2 ? sign * h / 2 : h / 2)
                ])
                    rotate([axis == 0 ? 0 : 90, axis == 1 ? 90 : 0, 0])
                        cube([w * 2, d * 2, chamfer * 2], center = true);
    }
}

module rounded_cylinder(height = 10, radius = 5, round_bottom = true, round_top = true) {
    if (round_bottom && round_top) {
        hull() {
            sphere(r = radius, $fn = 48);
            translate([0, 0, height]) sphere(r = radius, $fn = 48);
        }
    } else if (round_bottom) {
        hull() {
            sphere(r = radius, $fn = 48);
            translate([0, 0, height]) cylinder(h = 0.01, r = radius, $fn = 48);
        }
    } else if (round_top) {
        hull() {
            cylinder(h = 0.01, r = radius, $fn = 48);
            translate([0, 0, height]) sphere(r = radius, $fn = 48);
        }
    } else {
        cylinder(h = height, r = radius, $fn = 48);
    }
}