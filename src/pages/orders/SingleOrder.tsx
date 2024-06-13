import { Breadcrumb, Flex, Space } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';

const SingleOrder = () => {
    return (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Flex justify="space-between">
                <Breadcrumb
                    separator={<RightOutlined />}
                    items={[
                        { title: <Link to="/">Dashboard</Link> },
                        { title: <Link to="/orders">Orders</Link> },
                        { title: `Order #123445554534545` },
                    ]}
                />
            </Flex>
        </Space>
    );
};

export default SingleOrder;
