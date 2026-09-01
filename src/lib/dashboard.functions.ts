import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type NextShift = {
  id: string;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  activity: string | null;
  notes: string | null;
};

export const getNextShift = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NextShift | null> => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("shifts")
      .select("id, shift_date, start_time, end_time, activity, notes")
      .eq("user_id", userId)
      .order("shift_date", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: false });

    if (error || !data || data.length === 0) return null;

    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const shift of data) {
      const date = shift.shift_date;
      if (!date) continue;

      if (date > todayISO) {
        return shift as NextShift;
      }

      if (date === todayISO) {
        if (!shift.start_time) {
          // Journée entière (RTT, RH, JNT) — afficher si c'est aujourd'hui
          return shift as NextShift;
        }
        const startMinutes =
          parseInt(shift.start_time.slice(0, 2), 10) * 60 +
          parseInt(shift.start_time.slice(3, 5), 10);
        if (startMinutes >= currentMinutes) {
          return shift as NextShift;
        }
      }
    }

    return null;
  });
