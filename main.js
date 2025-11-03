import "dotenv/config"; // โหลด .env หนึ่งครั้งพอ ต้นทางของแอป
import { raw_mat_calculate } from "./rm_calculate.js";

async function run() {
    const data = await raw_mat_calculate("C251");
    // console.log("Result from active_plan:", data);
}

run();
