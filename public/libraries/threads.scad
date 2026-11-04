// ============================================================
// threads.scad — Screw / Bolt Thread Generators
// ============================================================

module metric_bolt(
    length = 20,
    diameter = 6,
    pitch = 1,
    head_diameter = 10,
    head_height = 4,
    head_type = "hex"  // "hex" | "socket" | "none"
) {
    // Shaft with thread
    thread_length = length;
    
    // Simplify: helical thread as sphere chain
    r_major = diameter / 2;
    r_minor = r_major - pitch * 0.6;
    steps_per_turn = 16;
    total_turns = thread_length / pitch;
    total_steps = ceil(total_turns * steps_per_turn);
    
    // Head
    if (head_type == "hex") {
        cylinder(h = head_height, d = head_diameter, $fn = 6);
    } else if (head_type == "socket") {
        cylinder(h = head_height, d = head_diameter, $fn = 32);
        translate([0, 0, -0.1])
            cylinder(h = 3, d = head_diameter * 0.5, $fn = 6);
    }
    
    // Threaded shaft (approx with sphere chain)
    translate([0, 0, head_height])
        union() {
            cylinder(h = thread_length - 1, r = r_minor, $fn = 32);
            for (i = [0 : total_steps - 1]) {
                t = i / steps_per_turn;
                ang = t * 360;
                z = t * pitch;
                rotate([0, 0, ang])
                    translate([r_major - 0.3, 0, z])
                        sphere(r = pitch * 0.55, $fn = 8);
            }
            // Tapered tip
            translate([0, 0, thread_length - 1])
                cylinder(h = 1, r1 = r_minor, r2 = 0, $fn = 32);
        }
}

module threaded_hole(
    depth = 20,
    diameter = 6,
    pitch = 1
) {
    // Simplified: cylinder hole (for printing, threads often tapped after)
    cylinder(h = depth, d = diameter, $fn = 32);
}