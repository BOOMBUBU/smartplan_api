import axios from "axios";

const URL_MASTER = process.env.URL_MASTER;
const token = process.env.token; // <- ชื่อ key ใน .env ต้องตรงนะ

export async function active_plan(plant) {
    const payload = {
        table: "scheduleActivePlan",
        search: {
            plant: plant,
        },
    };

    const res = await axios.post(
        URL_MASTER,
        payload,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        }
    );

    return res.data;
};

export async function master_mrp_bom(plant) {
    try {
        const payload = {
            table: "masterMRPBOM",
            search: {
                StockPlant: plant,
            },
        };

        const res = await axios.post(
            URL_MASTER,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return res.data;
    } catch (error) {
        return [];
    }

};

export async function master_mrp_stock(plant) {
    try {
        const payload = {
            table: "masterMRPStock",
            // search: {
            //     plant: plant,
            // },
        };

        const res = await axios.post(
            URL_MASTER,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return res.data;
    } catch (error) {
        return [];
    }

};
