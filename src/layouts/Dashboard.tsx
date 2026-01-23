import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store';

const Dashboard = () => {
    // call getself
    const { user } = useAuthStore();
    if (user === null) {
        return <Navigate to="/auth/login" replace={true} />;
    }
    return (
        <div>
            <h1>Dashboard component</h1>
            <Outlet />
        </div>
    );
};

export default Dashboard;
