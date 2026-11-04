// ============================================================
// electronics.scad — PCB Mount, Cable Clip, Battery Holder
// Untuk enclosure, mounting, prototyping electronics.
// ============================================================

// PCB mounting standoff dengan bolt hole
module pcb_standoff(
    height = 5,
    outer_d = 6,
    hole_d = 3,
    bolt_head_d = 5.5  // untuk M3 socket
) {
    difference() {
        union() {
            cylinder(h = height, d = outer_d, $fn = 32);
            // Bolt head recess di bawah (opsional)
        }
        // Bolt hole
        translate([0, 0, -0.1])
            cylinder(h = height + 0.2, d = hole_d, $fn = 24);
    }
}

// 4 PCB mounting posts (untuk 1 PCB)
module pcb_mount_4x(
    spacing_x = 50,
    spacing_y = 30,
    standoff_h = 5,
    bolt_d = 3
) {
    for (x = [0, spacing_x]) {
        for (y = [0, spacing_y]) {
            translate([x, y, 0])
                pcb_standoff(standoff_h, bolt_d * 2, bolt_d);
        }
    }
}

// Cable clip (untuk kabel 3-8mm diameter)
module cable_clip(
    cable_d = 5,
    wall = 1.5,
    length = 8,
    gap_angle = 100  // derajat bukaan
) {
    r = cable_d / 2;
    outer_r = r + wall;
    
    difference() {
        // Cincin
        rotate([90, 0, 0])
            linear_extrude(height = length, center = true) {
                difference() {
                    circle(r = outer_r, $fn = 32);
                    circle(r = r, $fn = 32);
                }
            }
        // Buka C-shape (bawah)
        rotate([90, 0, 0])
            translate([0, 0, -length / 2 - 0.1])
                cylinder(
                    h = length + 0.2,
                    r = outer_r + 1,
                    $fn = 32,
                    center = false,
                    angle = gap_angle,
                    start_angle = 180 - gap_angle / 2
                );
        // Hapus material di celah C-shape
        rotate([90, 0, 0])
            translate([0, 0, -length / 2 - 0.1])
                linear_extrude(height = length + 0.2) {
                    a1 = 180 + gap_angle / 2;
                    a2 = 180 - gap_angle / 2;
                    polygon([
                        [0, 0],
                        [outer_r * 2 * cos(a1), outer_r * 2 * sin(a1)],
                        [outer_r * 2 * cos(a2), outer_r * 2 * sin(a2)]
                    ]);
                }
    }
}

// Battery holder (AA/AAA/18650)
module battery_holder(
    battery_type = "AA",  // "AA", "AAA", "18650", "CR2032"
    count = 2
) {
    // Dimensi (length, diameter)
    dims = 
        battery_type == "AA"   ? [50.5, 14.5] :
        battery_type == "AAA"  ? [44.5, 10.5] :
        battery_type == "18650" ? [65, 18.4] :
        battery_type == "CR2032" ? [20, 3.2] :
        [50.5, 14.5];
    
    bat_l = dims[0];
    bat_d = dims[1];
    wall = 1.5;
    tol = 0.3;
    
    for (i = [0 : count - 1]) {
        translate([0, i * (bat_d + 2 * wall + tol), 0])
            difference() {
                cylinder(h = bat_l + 2 * wall, r = bat_d / 2 + wall, $fn = 32);
                translate([0, 0, wall - 0.1])
                    cylinder(h = bat_l + wall + 0.2, r = bat_d / 2 + tol, $fn = 32);
            }
    }
}

// Raspi 3/4 mounting
module raspi_mount(raspi_type = "4") {
    // Hole spacing: Pi 4 = 58 x 49, Pi 3 = 58 x 49 (sama)
    pcb_mount_4x(58, 49, 5, 2.7);  // M2.5 self-tap
}

// Contoh pemakaian:
// pcb_mount_4x(58, 49, 5, 3);
// cable_clip(5, 1.5, 8);