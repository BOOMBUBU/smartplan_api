import { active_plan, master_mrp_bom, master_mrp_stock } from "./load_data.js";
import { convertTONtoKg } from "./global_fn.js";
import moment from "moment";
import { promises as fs } from "fs";
import * as XLSX from "xlsx";
import { machine } from "os";

export async function raw_mat_calculate(plant) {
    let lst_active_plan = await active_plan(plant);
    lst_active_plan.forEach(e => {
        e.start = moment(e.start, "YYYY-MM-DD HH:mm");
        e.end = moment(e.end, "YYYY-MM-DD HH:mm");
    });
    let lst_master_mrp_bom = await master_mrp_bom(plant);
    lst_master_mrp_bom = lst_master_mrp_bom.filter(
        (row) => String(row?.MaterialSubGroup ?? "")
            .trim()
            .toUpperCase() === "COLOR"
    );
    let lst_master_mrp_stock = await master_mrp_stock(plant);
    let min_date_stock = moment.min(lst_master_mrp_stock.map(r => moment(r['Download Date'])));
    let machines = [...new Set(lst_active_plan.map(row => row.machine))];
    let ms_bom_mrp = [...new Set(lst_master_mrp_bom.map(row => row.Material))].map(m => {
        return {
            mat_code: m,
            bom: lst_master_mrp_bom.filter(r => r.Material === m && parseFloat(r.Qty) > 0).map(i => {
                return {
                    item_id: i.ItemID,
                    qty: convertTONtoKg(i.Qty, i.Unit),
                    unit: "KG",
                }
            })
        }
    });
    let stock_used_log = []
    let mrp_stock = lst_master_mrp_stock.filter(f => f.RawmatGroup === "COLOR").map(stock => {
        return {
            item_id: stock['Material Number'],
            total: stock['Stock_UR_Qty'],
            stock_date: moment(stock['Download Date']),
            unit: stock['Base Unit Of Measure'],
            group: stock['RawmatGroup'],
            used: 0,

        }
    });
    lst_active_plan.forEach(e => e['raw_materials'] = [])
    for (const mc of machines) {
        if (["CM1", "CM2"].includes(mc)) {
            let data = lst_active_plan.filter(row => row.machine === mc && row.type === "งานผลิต");
            data = data.sort((a, b) => a.start.valueOf() - b.start.valueOf());
            // console.log(`\nMachine: ${mc} - Total Jobs: ${data.length}`);
            data.forEach(job => {
                // console.log("Processing Job:", job);
                let qty_required = parseFloat(job.pcs);
                const bom_item = ms_bom_mrp.find(b => b.mat_code === job.code);
                // console.log(`Material: ${job.code} ==> requires qty: ${qty_required}`);
                let lst_rm = []
                if (bom_item) {
                    bom_item.bom.forEach(bom => {
                        // console.table('BOM Item:', bom)
                        let item_weight = bom.qty * qty_required;
                        // console.log(`---> Requires Item ID: ${bom.item_id} - Qty: ${item_weight} ${bom.unit}`);
                        const stock_item = mrp_stock.find(s => s.item_id === bom.item_id);
                        // Calculate available stock
                        let available_qty = 0;
                        if (stock_item) {
                            available_qty = stock_item.total - stock_item.used;
                        }
                        // Determine how much can be allocated
                        let item_req = 0;
                        let item_used = 0;
                        if (available_qty >= item_weight) {
                            item_used = item_weight;
                        } else {
                            item_used = available_qty;
                            item_req = item_weight - available_qty;
                        }
                        stock_item.used += item_used;
                        lst_rm.push({
                            mat_code: job.code,
                            item_id: bom.item_id,
                            request: item_req,
                            used: item_used,
                            available_qty: available_qty,
                            item_min_batch: item_req > 0 ? available_qty * bom.qty : item_weight,
                            item_weight: item_weight,
                            job_start: job.start.format("YYYY-MM-DD HH:mm"),
                        });

                    })
                }
                let suggest_pcs = Math.min(...lst_rm.map(r => r.item_min_batch))
                lst_rm.forEach(r => r.suggest_pcs = suggest_pcs);
                job.raw_materials = lst_rm;
                stock_used_log = stock_used_log.concat(lst_rm);
            })
        };
    }

    // สมมติ import moment แล้ว: import moment from "moment";
    lst_active_plan = lst_active_plan.filter(r=>r.start >=min_date_stock)
    console.log("lst_active_plan",min_date_stock.format("YYYY-MM-DD"), lst_active_plan.length)

    const data_row = lst_active_plan.flatMap(r => {
        const raws = Array.isArray(r.raw_materials) ? r.raw_materials : [];
        return raws.map(rm => ({
            job_id: r._id,
            plant: r.plant,
            machine: r.machine,
            mat_code: r.code,
            priority: r.commit,
            job_start: moment(r.start).format("YYYY-MM-DD HH:mm"), // เวลาเริ่มของงาน
            job_end: moment(r.end).format("YYYY-MM-DD HH:mm"),
            pcs: r.pcs,
            item_id: rm.item_id,
            available_qty: rm.available_qty,
            used: rm.used,
            request: rm.request,
            suggest_pcs: rm.suggest_pcs,
            rm_job_start: rm.job_start ? moment(rm.job_start).format("YYYY-MM-DD HH:mm") : null, // เปลี่ยนชื่อคีย์กันชนกัน
        }));
    });

    // console.table(stock_used_log);
    // 1) แปลงเป็น worksheet
    const ws_log = XLSX.utils.json_to_sheet(stock_used_log);
    const ws_data = XLSX.utils.json_to_sheet(data_row);

    // // 2) สร้าง workbook แล้วใส่ชีต
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws_data, "data");
    XLSX.utils.book_append_sheet(wb, ws_log, "stock_used_log");

    // // 3) เขียนไฟล์ .xlsx
    XLSX.writeFile(wb, "./data.xlsx");

    return lst_active_plan
}