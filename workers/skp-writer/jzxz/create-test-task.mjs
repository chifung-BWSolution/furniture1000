// Creates a local 建築學長 trial task: node create-test-task.mjs [task_id] [reference image ...]
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(process.env.FDS_JZXZ_TASK_ROOT || join(process.env.LOCALAPPDATA ?? '', 'FDS', 'SkpWorker', 'jzxz-tasks'));
const [taskId = 'TEST-001', ...images] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,64}$/.test(taskId)) throw new Error('task_id 格式不正確');

const dir = join(root, taskId);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'refs'), { recursive: true });
mkdirSync(join(dir, 'output'), { recursive: true });

const refs = images.map((path, i) => {
  if (!existsSync(path)) throw new Error(`找不到參考圖 ${path}`);
  const name = `${i + 1}-${basename(path)}`;
  copyFileSync(path, join(dir, 'refs', name));
  return `refs/${name}`;
});

writeFileSync(join(dir, 'task.json'), JSON.stringify({
  task_id: taskId,
  product: { name: '直身辦公桌', model: 'TEST-DESK-1400', category: '辦公桌' },
  dimensions_mm: { width: 1400, depth: 700, height: 750 },
  materials: '桌面淺木紋 25 mm 厚；黑色金屬方管 U 形腳架',
  notes: '桌面下方有 18 mm 前擋板（離地 300 mm 起），兩側腳架各一',
  reference_images: refs,
  output_skp: `output/${taskId}.skp`,
}, null, 2));

console.log(dir);
