// ============================================================
// joints.scad — Snap Fit, Dovetail, Ball Joint, Living Hinge
// Untuk enclosure, mechanical parts, robot chassis.
// ============================================================

// Snap fit clip (protruding clip)
module snap_fit_clip(
    length = 10,
    width = 3,
    height = 6,
    hook_height = 2,
    hook_overhang = 1.5
) {
    // Batang
    cube([length, width, height]);
    // Hook di ujung
    translate([length - hook_overhang, 0, height - hook_height])
        rotate([0, 0, 0])
        linear_extrude(height = width)
            polygon(points = [
                [0, 0],
                [hook_overhang + 0.5, 0],
                [hook_overhang + 0.5, hook_height],
                [0, hook_height - hook_height * 0.3]
            ]);
}

// Dovetail male (untuk slider joint)
module dovetail_male(
    width = 20,
    height = 10,
    depth = 5,
    angle = 15  // derajat kemiringan
) {
    // Trapesium (lebar bawah lebih besar)
    top_w = width - 2 * depth * tan(angle);
    linear_extrude(height = height)
        polygon(points = [
            [0, 0],
            [width, 0],
            [width - (width - top_w) / 2, depth],
            [(width - top_w) / 2, depth]
        ]);
}

// Dovetail female (pasangan)
module dovetail_female(
    width = 20,
    height = 10,
    depth = 5,
    angle = 15,
    tolerance = 0.3
) {
    top_w = width - 2 * depth * tan(angle);
    linear_extrude(height = height + tolerance)
        polygon(points = [
            [-tolerance, -tolerance],
            [width + tolerance, -tolerance],
            [width - (width - top_w) / 2 + tolerance, depth + tolerance],
            [(width - top_w) / 2 - tolerance, depth + tolerance]
        ]);
}

// Ball joint socket (untuk robotic arm)
module ball_socket(
    ball_d = 8,
    socket_wall = 1.5,
    gap_angle = 120  // derajat bukaan (0-180)
) {
    r = ball_d / 2 + socket_wall;
    
    difference() {
        sphere(r = r, $fn = 32);
        sphere(r = ball_d / 2, $fn = 32);
        // Buka bagian atas agar ball bisa masuk
        rotate([0, 0, 0])
            cylinder(h = r * 2, d = ball_d - 0.5, $fn = 32);
        // Irisan samping (agar bisa melentur)
        translate([-r, 0, -r])
            cube([r * 2, r * 2, r * 3]);
    }
}

// Living hinge (untuk kotak yang bisa dilipat)
module living_hinge(
    length = 20,
    width = 3,
    thickness = 0.6,
    slots = 6
) {
    slot_w = (length / slots) * 0.6;
    gap = (length / slots) * 0.4;
    
    linear_extrude(height = thickness) {
        square([length, width]);
        for (i = [0 : slots - 1]) {
            translate([i * (length / slots) + gap / 2, -0.1])
                square([gap / 2, width + 0.2]);
        }
    }
}

// Contoh pemakaian:
// snap_fit_clip(12, 3, 8, 2.5, 1.5);
// ball_socket(8, 1.5, 120);