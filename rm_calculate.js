import { active_plan, master_mrp_bom, master_mrp_stock } from "./load_data.js";
import { convertTONtoKg } from "./global_fn.js";
import moment from "moment";
import fs from 'fs';
import * as XLSX from "xlsx";

export async function raw_mat_calculate(plant) {
    let lst_active_plan = await active_plan(plant) ?? [];
    // lst_active_plan = lst_active_plan.filter(f => f.code == 'ZCA65110164001')
    // let path = `/Users/kessarabhornchuysud/Downloads/activePlan.json`
    // let raw = fs.readFileSync(path)
    // let lst_active_plan = JSON.parse(raw);
    // console.log(lst_active_plan.length)
    let lst_master_mrp_bom = await master_mrp_bom(plant) ?? [];
    let lst_master_mrp_stock = await master_mrp_stock(plant) ?? [];
    lst_active_plan.forEach(e => {
        e.start = moment(e.start);
        e.end = moment(e.end);
        // e.start = moment(e.start, "YYYY-MM-DD HH:mm");
        // e.end = moment(e.end, "YYYY-MM-DD HH:mm");
        e['raw_materials'] = []
    });
    lst_master_mrp_bom = lst_master_mrp_bom.filter(
        (row) => String(row?.ItemDescription ?? "")
            .trim()
            .toUpperCase() != "WATER"
    );
    let ap = lst_active_plan.filter(r => ['CM1', 'CM2'].includes(r.machine) && r.type === "งานผลิต");
    let min_date_stock = moment.min(lst_master_mrp_stock.map(r => moment(r['Download Date'])));
    let min_date_ap = moment.min(lst_active_plan.map(r => moment(r['start'])));
    console.log(min_date_stock.format("YYYY-MM-DD HH:mm:ss"), min_date_ap.format("YYYY-MM-DD HH:mm:ss"))
    let machines = [...new Set(ap.map(row => row.machine))];
    let ms_bom_mrp = [...new Set(lst_master_mrp_bom.map(row => row.Material))].map(m => {
        let lst_bom = lst_master_mrp_bom.filter(r => r.Material === m && parseFloat(r.Qty) > 0)
        let exclude = [
            ...new Set(
                (lst_bom ?? [])
                    .map(i => i?.ItemIDBefore ?? "")
                    .map(s => String(s).trim())
                    .filter(s => s !== "")
            )
        ];
        let select = lst_bom.filter(f => !exclude.includes(f.ItemID))
        // console.table(select)
        let bom = select.map(i => {
            let obj = {
                item_id: i.ItemID,
                qty: convertTONtoKg(i.Qty, i.Unit),
                unit: "KG",
                type: i.MaterialSubGroup,
                buyer_plant: i.BuyerPlant,

            };
            return obj
        })
        return {
            mat_code: m,
            bom: bom
        }
    });
    let stock_used_log = []
    let mrp_stock = lst_master_mrp_stock.map(stock => {
        return {
            item_id: stock['Material Number'],
            total: stock['Stock_UR_Qty'],
            stock_date: moment(stock['Download Date']),
            unit: stock['Base Unit Of Measure'],
            group: stock['RawmatGroup'],
            used: 0,
            plant: stock['Plant'] ?? stock['plant'],

        }
    });
    ap = ap.filter(f => f.start >= min_date_stock);
    ap = ap.sort((a, b) => a.start.valueOf() - b.start.valueOf());
    if (ap.length > 0) {
        for (const mc of machines) {
            let data = ap.filter(row => row.machine === mc);
            // console.log("data",data)
            data = data.sort((a, b) => a.start.valueOf() - b.start.valueOf());
            data.forEach(job => {
                let qty_required = parseFloat(job.pcs);
                const bom_item = ms_bom_mrp.find(b => b.mat_code === job.code);
                // console.log("qty_required",qty_required)
                let lst_rm = []
                if (bom_item) {
                    bom_item.bom.forEach(bom => {
                        let item_weight = bom.qty * qty_required;
                        let stock_item = mrp_stock.find(s => s.item_id === bom.item_id && s.plant === bom.buyer_plant);
                        // console.log(item_weight,bom,stock_item)
                        let available_qty = 0;
                        if (stock_item) {
                            available_qty = stock_item.total - stock_item.used;
                        } else {
                            stock_item = {
                                stock_date: min_date_stock,
                                unit: 'KG',
                                group: null,
                                item_id: bom.item_id,
                                plant: bom.buyer_plant,
                                total: 0,
                                used: 0
                            }
                            mrp_stock.push(stock_item)
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
                            bom_id: bom.item_id,
                            request: item_req,
                            used: item_used,
                            available_qty: available_qty,
                            item_min_batch: item_used/bom.qty,
                            item_weight: item_weight,
                            job_start: job.start,
                            buyer_plant: bom.buyer_plant,
                            material_group : bom.type,
                            bom_rate : bom.qty
                        });
                    })
                } else {
                    lst_rm.push({
                            mat_code: job.code,
                            bom_id: null,
                            request: null,
                            used: null,
                            available_qty: null,
                            item_min_batch: null,
                            item_weight: null,
                            job_start: null,
                            buyer_plant: null,
                            material_group:null,
                            bom_rate:null
                        });
                    console.log(`No BOM found for material code: ${job.code}`);
                }
                // console.table(lst_rm)
                const nums = (lst_rm ?? [])
                    .map(r => Number(r?.item_min_batch))
                    .filter(n => Number.isFinite(n));          // กัน null/undefined/NaN

                let suggest_pcs = nums.length ? Math.min(...nums) : 0; // ถ้าว่างให้เป็น 0
                suggest_pcs = Math.abs(suggest_pcs) < 1e-10 ? 0 : Number(suggest_pcs.toFixed(10));
                lst_rm.forEach(r => r.suggest_pcs = suggest_pcs);
                let item = lst_active_plan.find(f => f._id == job._id)
                if (item) {
                    item.raw_materials = lst_rm;
                }

                stock_used_log = stock_used_log.concat(lst_rm);
            })
        }
    }

    // const data_row = lst_active_plan.flatMap(r => {
    //     const raws = Array.isArray(r.raw_materials) ? r.raw_materials : [];
    //     return raws.map(rm => ({
    //         job_id: r._id,
    //         plant: r.plant,
    //         machine: r.machine,
    //         mat_code: r.code,
    //         priority: r.commit,
    //         job_start: moment(r.start).format("YYYY-MM-DD HH:mm"), // เวลาเริ่มของงาน
    //         job_end: moment(r.end).format("YYYY-MM-DD HH:mm"),
    //         pcs: r.pcs,
    //         item_id: rm.bom_id,
    //         available_qty: rm.available_qty,
    //         used: rm.used,
    //         request: rm.request,
    //         suggest_pcs: rm.suggest_pcs,
    //         rm_job_start: rm.job_start ? moment(rm.job_start).format("YYYY-MM-DD HH:mm") : null, // เปลี่ยนชื่อคีย์กันชนกัน
    //         buyer_plant: rm.buyer_plant,
    //         material_group: rm.material_group,
    //         bom_rate:rm.bom_rate
    //     }));
    // });

    // console.table(data_row)

    // // console.table(stock_used_log);
    // // 1) แปลงเป็น worksheet
    // const ws_log = XLSX.utils.json_to_sheet(stock_used_log);
    // const ws_data = XLSX.utils.json_to_sheet(data_row);

    // // // 2) สร้าง workbook แล้วใส่ชีต
    // const wb = XLSX.utils.book_new();
    // XLSX.utils.book_append_sheet(wb, ws_data, "data");
    // XLSX.utils.book_append_sheet(wb, ws_log, "stock_used_log");

    // // // 3) เขียนไฟล์ .xlsx
    // XLSX.writeFile(wb, "./data.xlsx");

    // console.dir(lst_active_plan, { depth: null })
    // console.log(lst_active_plan.length)
    // for (const element of lst_active_plan.filter(f=>f.code =='ZCA66100102005')) {
    //     if (['CM1', 'CM2'].includes(element.machine) & element.pcs > 0) {
    //         console.log(element.code, element.plant, element.machine, moment(element.start).format('YYYY-MM-DD HH:mm:ss'), element.raw_materials.length)
    //         console.dir(element.raw_materials)
    //         // if (element.raw_materials.filter(f => f.request > 0).length) {
    //         //     console.log(element.code, element.plant, element.machine, moment(element.start).format('YYYY-MM-DD HH:mm:ss'), element.raw_materials.length)
    //         //     console.dir(element.raw_materials)
    //         // } else {
    //         //     console.log("non require",element.code, element.plant, element.machine, moment(element.start).format('YYYY-MM-DD HH:mm:ss'), element.raw_materials.length)
    //         //     console.dir(element.raw_materials)
    //         // }
    //     }
    // }
    return lst_active_plan
}