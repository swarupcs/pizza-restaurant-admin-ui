import { Card, Col, Form, Input, Row, Select, Space } from 'antd';
import { getTenants } from '../../../http/api';
import { useQuery } from '@tanstack/react-query';
import { Tenant } from '../../../types';

const UserForm = () => {
    const { data: tenants } = useQuery({
        queryKey: ['tenants'],
        queryFn: () => {
            return getTenants().then((res) => res.data);
        },
    });

    return (
        <Row>
            <Col span={24}>
                <Space direction="vertical" size="large">
                    <Card title="Basic info" bordered={false}>
                        <Row gutter={20}>
                            <Col span={12}>
                                <Form.Item
                                    label="First name"
                                    name="firstName"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'First name is required',
                                        },
                                    ]}>
                                    <Input size="large" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item
                                    label="Last name"
                                    name="lastName"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Last name is required',
                                        },
                                    ]}>
                                    <Input size="large" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item
                                    label="Email"
                                    name="email"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Email is required',
                                        },
                                        {
                                            type: 'email',
                                            message: 'Email is not valid',
                                        },
                                    ]}>
                                    <Input size="large" />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Card>

                    <Card title="Security info" bordered={false}>
                        <Row gutter={20}>
                            <Col span={12}>
                                <Form.Item
                                    label="Passoword"
                                    name="password"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Password required',
                                        },
                                    ]}>
                                    <Input size="large" type="password" />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Card>

                    <Card title="Role" bordered={false}>
                        <Row gutter={20}>
                            <Col span={12}>
                                <Form.Item
                                    label="Role"
                                    name="role"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Role is required',
                                        },
                                    ]}>
                                    <Select
                                        size="large"
                                        style={{ width: '100%' }}
                                        allowClear={true}
                                        onChange={() => {}}
                                        placeholder="Select role">
                                        <Select.Option value="admin">Admin</Select.Option>
                                        <Select.Option value="manager">Manager</Select.Option>
                                        <Select.Option value="customer">Customer</Select.Option>
                                    </Select>
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item
                                    label="Restaurant"
                                    name="tenantId"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Restaurant is required',
                                        },
                                    ]}>
                                    <Select
                                        size="large"
                                        style={{ width: '100%' }}
                                        allowClear={true}
                                        onChange={() => {}}
                                        placeholder="Select restaurant">
                                        {tenants?.map((tenant: Tenant) => (
                                            <Select.Option value={tenant.id}>
                                                {tenant.name}
                                            </Select.Option>
                                        ))}
                                    </Select>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Card>
                </Space>
            </Col>
        </Row>
    );
};

export default UserForm;
