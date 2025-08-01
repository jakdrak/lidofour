// api/data.ts
import { kv } from '@vercel/kv';
import type { NextApiRequest, NextApiResponse } from 'next';

// Define interfaces to match the frontend. It's good practice to share these.
interface Visitor { id: number; name: string; contact: string; purpose: string; resident: string; block?: string; houseNo?: string; vehicle?: string; carBrand?: string; photo?: string; status: string; checkInTime?: string; checkOutTime?: string; }
interface User { id: number; username: string; password?: string; role: string; unitNo?: string; }
interface CompanyInfo { name: string; logo: string; address: string; welcomeMessage: string; personInCharge: string; contactNumber: string; }
interface PredefinedUnit { block: string; houseNo: string; }
interface PendingChat { id: number; userId: number | null; userName: string; unit: string; initialQuery: string; messages: any[]; dismissed: boolean; adminReplied: boolean; }

// --- DEFAULT/MOCK DATA for initial setup ---
const mockUsers: User[] = [
    { id: 1, username: 'admin', password: 'password', role: 'Admin' },
    { id: 2, username: 'security', password: 'password', role: 'Security' },
    { id: 3, username: 'officer', password: 'password', role: 'Officer' },
    { id: 4, username: 'resident101', password: 'password', role: 'Resident', unitNo: 'A-101' },
    { id: 5, username: 'resident203', password: 'password', role: 'Resident', unitNo: 'B-203' },
];

const mockUnits: PredefinedUnit[] = [
    { block: 'A', houseNo: '101' }, { block: 'A', houseNo: '102' }, { block: 'A', houseNo: '103' },
    { block: 'B', houseNo: '201' }, { block: 'B', houseNo: '202' }, { block: 'B', houseNo: '203' },
    { block: 'C', houseNo: '301' }, { block: 'C', houseNo: '305' }, { block: 'D', houseNo: '401' },
];

const initialVisitors: Visitor[] = [
    { id: 1, name: 'ALICE JOHNSON', contact: '555-1234', purpose: 'DELIVERY', resident: 'A-101', block: 'A', houseNo: '101', status: 'Approved', vehicle: 'XYZ 123', carBrand: 'TOYOTA' },
    { id: 2, name: 'BOB WILLIAMS', contact: '555-5678', purpose: 'MAINTENANCE', resident: 'B-203', block: 'B', houseNo: '203', status: 'Checked-in', checkInTime: new Date(Date.now() - 3600 * 1000).toISOString() },
    { id: 3, name: 'CHARLIE BROWN', contact: '555-8765', purpose: 'PERSONAL VISIT', resident: 'C-305', block: 'C', houseNo: '305', status: 'Pending' },
];

const initialCompanyInfo: CompanyInfo = {
    name: 'ResiGuard Cloud', logo: '', address: '123 Security Lane, Suite 100',
    welcomeMessage: 'Welcome to our secure facility.', personInCharge: 'Admin User', contactNumber: '555-0100',
};

// Main API handler
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'GET') {
        try {
            // Fetch all data points from KV. If a key doesn't exist, fall back to the initial mock data.
            const visitors = await kv.get<Visitor[]>('visitors') ?? initialVisitors;
            const users = await kv.get<User[]>('users') ?? mockUsers;
            const companyInfo = await kv.get<CompanyInfo>('companyInfo') ?? initialCompanyInfo;
            const predefinedUnits = await kv.get<PredefinedUnit[]>('predefinedUnits') ?? mockUnits;
            const pendingChats = await kv.get<PendingChat[]>('pendingChats') ?? [];
            const sessions = await kv.get<Record<string, number>>('sessions') ?? {};

            // If the data was from the fallback, set it in KV for subsequent requests.
            if (!(await kv.exists('visitors'))) await kv.set('visitors', initialVisitors);
            if (!(await kv.exists('users'))) await kv.set('users', mockUsers);
            if (!(await kv.exists('companyInfo'))) await kv.set('companyInfo', initialCompanyInfo);
            if (!(await kv.exists('predefinedUnits'))) await kv.set('predefinedUnits', mockUnits);
            
            res.status(200).json({
                visitors,
                users,
                companyInfo,
                predefinedUnits,
                pendingChats,
                sessions,
            });
        } catch (error) {
            console.error('Error fetching data from Vercel KV:', error);
            res.status(500).json({ error: 'Failed to fetch data' });
        }
    } else if (req.method === 'POST') {
        try {
            const { visitors, users, companyInfo, predefinedUnits, pendingChats, sessions } = req.body;
            
            // Use Promise.all to save all data concurrently for better performance.
            await Promise.all([
                kv.set('visitors', visitors),
                kv.set('users', users),
                kv.set('companyInfo', companyInfo),
                kv.set('predefinedUnits', predefinedUnits),
                kv.set('pendingChats', pendingChats),
                kv.set('sessions', sessions),
            ]);
            
            res.status(200).json({ message: 'Data saved successfully' });
        } catch (error) {
            console.error('Error saving data to Vercel KV:', error);
            res.status(500).json({ error: 'Failed to save data' });
        }
    } else {
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}