import { redirect } from 'next/navigation';

export default function AppUpgradePage() {
  redirect('/checkout?plan_id=student_premium');
}
