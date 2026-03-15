import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearNavigator, setNavigator } from '../../lib/navigation';

export default function NavigationBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    setNavigator(navigate);

    return () => {
      clearNavigator();
    };
  }, [navigate]);

  return null;
}