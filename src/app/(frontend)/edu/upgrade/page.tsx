import { redirect } from 'next/navigation';

export default function EduUpgradePage() {
  redirect('/checkout?plan_id=teacher_license');
}
