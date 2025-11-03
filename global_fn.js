export function convertTONtoKg(qty, unit) {
    let qty_kg = 0;
    switch (unit) {
        case "TON":
            qty_kg =parseFloat((qty * 1000).toFixed(10));
            break;
        case "KG":
            qty_kg = parseFloat((qty).toFixed(10));
            break;
        case "G":
            qty_kg = parseFloat((qty / 1000).toFixed(10));
            break;
        default:
            console.warn(`Unknown unit: ${unit}`);
            qty_kg = qty; // Assume it's in kg if unknown
    }
    return qty_kg;
}