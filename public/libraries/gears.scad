// ============================================================
// gears.scad — Parametric Gear Library
// Compatible dengan syntax MCAD gears (subset)
// ============================================================

// Gear dengan profil involute (approx)
module gear(
    number_of_teeth = 15,
    circular_pitch = 5,
    gear_thickness = 5,
    rim_thickness = 8,
    hub_thickness = 10,
    hub_diameter = 10,
    bore_diameter = 5,
    circles = 0
) {
    pitch_radius = circular_pitch * number_of_teeth / (2 * PI);
    outer_radius = pitch_radius + circular_pitch / PI;
    root_radius = pitch_radius - 1.25 * circular_pitch / PI;
    pitch_angle = 360 / number_of_teeth;
    tooth_thick = (PI * circular_pitch / PI) / (2 * pitch_radius);
    
    difference() {
        union() {
            // Rim & teeth
            linear_extrude(height = rim_thickness) {
                polygon([
                    for (i = [0 : number_of_teeth - 1])
                        each let(ang = i * pitch_angle)
                            for (p = [
                                [root_radius * cos(-ang * 0.35 + ang), root_radius * sin(-ang * 0.35 + ang)],
                                [outer_radius * cos(-ang * 0.15 + ang), outer_radius * sin(-ang * 0.15 + ang)],
                                [outer_radius * cos(ang * 0.15 + ang), outer_radius * sin(ang * 0.15 + ang)],
                                [root_radius * cos(ang * 0.35 + ang), root_radius * sin(ang * 0.35 + ang)]
                            ]) p
                ]);
            }
            // Hub
            cylinder(h = hub_thickness, d = hub_diameter, $fn = 32);
        }
        // Bore
        translate([0, 0, -1])
            cylinder(h = hub_thickness + 2, d = bore_diameter, $fn = 32);
        
        // Optional lightening holes
        if (circles > 0) {
            for (i = [0 : circles - 1]) {
                translate([
                    (rim_thickness - 0) * 0,
                    0, 0
                ])
                rotate([0, 0, i * 360 / circles])
                    translate([pitch_radius * 0.6, 0, -1])
                        cylinder(h = rim_thickness + 2, d = bore_diameter, $fn = 24);
            }
        }
    }
}

// Rack & Pinion helper
module rack(
    length = 50,
    width = 10,
    height = 5,
    circular_pitch = 5
) {
    tooth_pitch = circular_pitch;
    n_teeth = floor(length / tooth_pitch);
    
    union() {
        // Base
        cube([length, width, height]);
        // Teeth
        for (i = [0 : n_teeth - 1]) {
            translate([i * tooth_pitch + tooth_pitch / 2, width / 2, height])
                rotate([0, 0, 45])
                    cube([tooth_pitch * 0.6, tooth_pitch * 0.6, tooth_pitch * 0.8], center = true);
        }
    }
}

// Timing pulley (belt)
module timing_pulley(
    teeth = 20,
    pitch = 2,
    width = 6,
    bore = 5
) {
    pitch_diameter = teeth * pitch / PI;
    outer_diameter = pitch_diameter + pitch * 0.5;
    
    difference() {
        union() {
            cylinder(h = width, d = outer_diameter, $fn = 64);
            // Teeth ridges
            for (i = [0 : teeth - 1]) {
                rotate([0, 0, i * 360 / teeth])
                    translate([outer_diameter / 2 - pitch * 0.3, 0, 0])
                        cube([pitch * 0.6, pitch * 0.6, width], center = true);
            }
        }
        translate([0, 0, -1])
            cylinder(h = width + 2, d = bore, $fn = 32);
    }
}