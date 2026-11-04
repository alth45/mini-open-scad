// ============================================================
// enclosure.scad — Electronics Enclosure Helpers
// ============================================================

module pcb_standoff(height = 5, outer_d = 7, hole_d = 3) {
    difference() {
        cylinder(h = height, d = outer_d, $fn = 32);
        translate([0, 0, -0.1])
            cylinder(h = height + 0.2, d = hole_d, $fn = 24);
    }
}

module vent_slots(width = 20, height = 2, count = 4, spacing = 4) {
    for (i = [0 : count - 1]) {
        translate([0, i * (height + spacing), 0])
            cube([width, height, 10]);
    }
}

module box_with_lid(
    size = [60, 40, 30],
    wall = 2,
    lid_gap = 0.3
) {
    w = size[0]; d = size[1]; h = size[2];
    
    // Body
    translate([-(w + lid_gap * 2) / 2 - 2, 0, 0])
        difference() {
            cube([w, d, h], center = true);
            translate([0, 0, wall])
                cube([w - 2 * wall, d - 2 * wall, h], center = true);
        }
    
    // Lid
    translate([(w + lid_gap * 2) / 2 + 2, 0, 0])
        difference() {
            cube([w, d, wall], center = true);
            translate([0, 0, -wall / 2])
                cube([w - 2 * wall, d - 2 * wall, wall + 0.1], center = true);
        }
}