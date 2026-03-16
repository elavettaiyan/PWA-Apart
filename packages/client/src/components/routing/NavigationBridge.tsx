import { useEffect, useRef } from 'react';
import { type NavigateFunction, useNavigate } from 'react-router-dom';
import { clearNavigator, setNavigator } from '../../lib/navigation';

export default function NavigationBridge() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);

  navigateRef.current = navigate;

  useEffect(() => {
    const stableNavigator = ((to: any, options?: any) => navigateRef.current(to, options)) as NavigateFunction;
    setNavigator(stableNavigator);

    return () => {
      clearNavigator();
    };
  }, []);

  return null;
}