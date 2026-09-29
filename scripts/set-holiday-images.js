const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const DIR = 'assets/images/holidays/';

const LOCAL = {
    akwaibom: 'akwa-ibom', crossriver: 'cross-river', rivers: 'rivers', bayelsa: 'bayelsa', delta: 'delta', edo: 'edo',
    anambra: 'anambra', enugu: 'enugu', imo: 'imo', abia: 'abia', ebonyi: 'ebonyi',
    fct: 'fct', niger: 'niger', kwara: 'kwara', kogi: 'kogi', benue: 'benue', plateau: 'plateau', nasarawa: 'nasarawa',
    kano: 'kano', kaduna: 'kaduna', katsina: 'katsina', jigawa: 'jigawa', sokoto: 'sokoto', kebbi: 'kebbi', zamfara: 'zamfara',
    adamawa: 'adamawa', taraba: 'taraba', borno: 'borno', yobe: 'yobe', bauchi: 'bauchi', gombe: 'gombe',
};

const INTERNATIONAL = {
    'Ghana': 'ghana', 'Togo & Benin': 'togo-benin', 'Rwanda': 'rwanda', 'Lebanon': 'lebanon', 'Qatar': 'qatar',
    'Rwanda & Kenya': 'rwanda-kenya', 'Egypt & Lebanon': 'egypt-lebanon', 'Nairobi & Zanzibar': 'nairobi-zanzibar',
    'Kenya & Qatar': 'kenya-qatar', 'Rwanda & Qatar': 'rwanda-qatar', 'Tanzania & Qatar': 'tanzania-qatar',
    'Seychelles & Qatar': 'seychelles-qatar', 'Benin, Togo, Ghana': 'benin-togo-ghana',
};

function stateKey(s) {
    const v = String(s || '').toLowerCase().replace(/\s+state$/, '').replace(/[^a-z]/g, '');
    if (v.includes('federalcapitalterritory') || v.startsWith('fct') || v.includes('abuja')) return 'fct';
    return v;
}

(async () => {
    console.log(`\nHoliday images — ${APPLY ? 'APPLYING CHANGES' : 'DRY RUN (add --apply to write)'}${FORCE ? ' — replacing existing images' : ''}\n`);
    const holidays = await db.holiday.findMany({ where: { status: { not: 'ARCHIVED' } } });
    const ops = [];
    for (const h of holidays) {
        const slug = h.category === 'INTERNATIONAL' ? INTERNATIONAL[h.state] : LOCAL[stateKey(h.state)];
        if (!slug) continue;
        const current = Array.isArray(h.images) ? h.images : [];
        const path = DIR + slug + '.jpg';
        if (current[0] === path) continue;
        if (current.length && !FORCE) {
            console.log(`  SKIP   ${h.state.padEnd(24)} ${h.packageName.padEnd(36)} already has ${current[0]}`);
            continue;
        }
        console.log(`  SET    ${h.state.padEnd(24)} ${h.packageName.padEnd(36)} ${path}`);
        ops.push(db.holiday.update({ where: { id: h.id }, data: { images: [path, ...current.filter(i => i !== path)] } }));
    }
    if (APPLY && ops.length) await db.$transaction(ops);
    console.log(`\n${APPLY ? 'Done —' : 'Dry run only —'} ${ops.length} package(s) ${APPLY ? 'updated' : 'would be updated'}.`);
    await db.$disconnect();
})().catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
});
