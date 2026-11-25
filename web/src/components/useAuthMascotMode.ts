import { useEffect, useState } from 'react';
import type { AuthMascotMode } from './AuthMascot';

export function useAuthMascotMode(
  focusedPassword: string | null,
  passwordVisible: boolean,
): AuthMascotMode {
  const [timedPeek, setTimedPeek] = useState(false);

  useEffect(() => {
    if (!focusedPassword || passwordVisible) {
      setTimedPeek(Boolean(focusedPassword && passwordVisible));
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    setTimedPeek(false);

    const schedulePeek = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        setTimedPeek(true);
        timer = setTimeout(() => {
          if (cancelled) return;
          setTimedPeek(false);
          schedulePeek();
        }, 720);
      }, 2900);
    };

    schedulePeek();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [focusedPassword, passwordVisible]);

  if (!focusedPassword) return 'idle';
  return passwordVisible || timedPeek ? 'peeking' : 'covered';
}
