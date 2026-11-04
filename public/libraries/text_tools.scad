// ============================================================
// text_tools.scad — Text Embed, Circular Text, Label Generation
// Untuk signage, nameplate, emboss, marking.
// ============================================================

// Text centered + extruded (untuk emboss pada permukaan)
module text_centered(
    txt = "HELLO",
    size = 10,
    depth = 1,
    font = "helvetiker",
    bold = false
) {
    // Use 3D text via linear_extrude
    linear_extrude(height = depth)
        text(
            txt,
            size = size,
            font = bold ? "helvetiker:bold" : font,
            halign = "center",
            valign = "center"
        );
}

// Emboss text onto a flat surface (create emboss into cube)
module emboss_text(
    txt = "HELLO",
    size = 10,
    depth = 0.8,
    font = "helvetiker",
    position = [0, 0, 0]  // center of text
) {
    translate(position)
        linear_extrude(height = depth)
            text(txt, size = size, font = font, halign = "center", valign = "center");
}

// Circular text (mengelilingi lingkaran)
module text_circular(
    txt = "HELLO WORLD",
    radius = 30,
    text_size = 5,
    angle_start = 0,   // derajat
    letters_per_circle = 0  // 0 = otomatis (sesuai panjang string)
) {
    n = len(txt);
    if (n > 0) {
        angle_per = 360 / n;
        for (i = [0 : n - 1]) {
            char = txt[i];
            angle = angle_start + i * angle_per;
            
            rotate([0, 0, angle])
                translate([0, radius, 0])
                    rotate([0, 0, 0])
                        text(char, size = text_size, halign = "center", valign = "center");
        }
    }
}

// Label box (text + background box)
module label_box(
    txt = "LABEL",
    box_size = [30, 10, 1],
    text_size = 5,
    border = 1
) {
    w = is_list(box_size) ? box_size[0] : box_size;
    d = is_list(box_size) ? box_size[1] : box_size;
    h = is_list(box_size) ? box_size[2] : box_size;
    
    difference() {
        cube([w, d, h]);
        translate([border, border, -0.01])
            cube([w - 2 * border, d - 2 * border, h + 0.02]);
    }
    // Text extruded on top
    translate([w / 2, d / 2, h])
        linear_extrude(height = h * 0.5)
            text(txt, size = text_size, halign = "center", valign = "center");
}

// Number-only quick text
module number_label(n = 1, size = 10) {
    text_centered(str(n), size, size * 0.1);
}

// Contoh pemakaian:
// text_centered("HELLO", 15, 2, bold = true);
// text_circular("MINI OPENS CAD", 40, 5);
// label_box("Name", [40, 12, 2], 7, 1.5);