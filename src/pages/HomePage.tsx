import { Typography } from 'antd';
import { useAuthStore } from '../store';
const { Title } = Typography;
function HomePage() {
    const { user } = useAuthStore();
    return (
        <div>
            <Title level={4}>Welcome, {user?.firstName} 😀</Title>
        </div>
    );
}

export default HomePage;
