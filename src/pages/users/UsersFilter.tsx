import { Button, Card, Col, Input, Row, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

type UsersFilterProps = {
    onFilterChange: (filterName: string, filterValue: string) => void;
};
const UsersFilter = ({ onFilterChange }: UsersFilterProps) => {
    return (
        <Card>
            <Row justify="space-between">
                <Col span={16}>
                    <Row gutter={20}>
                        <Col span={8}>
                            <Input.Search
                                allowClear={true}
                                placeholder="Search"
                                onChange={(e) => onFilterChange('searchFilter', e.target.value)}
                            />
                        </Col>
                        <Col span={8}>
                            <Select
                                style={{ width: '100%' }}
                                allowClear={true}
                                onChange={(selectedItem) =>
                                    onFilterChange('roleFilter', selectedItem)
                                }
                                placeholder="Select role">
                                <Select.Option value="admin">Admin</Select.Option>
                                <Select.Option value="manager">Manager</Select.Option>
                                <Select.Option value="customer">Customer</Select.Option>
                            </Select>
                        </Col>
                        <Col span={8}>
                            <Select
                                style={{ width: '100%' }}
                                placeholder="Status"
                                allowClear={true}
                                onChange={(selectedItem) =>
                                    onFilterChange('statusFilter', selectedItem)
                                }>
                                <Select.Option value="ban">Ban</Select.Option>
                                <Select.Option value="active">Active</Select.Option>
                            </Select>
                        </Col>
                    </Row>
                </Col>
                <Col span={8} style={{ display: 'flex', justifyContent: 'end' }}>
                    <Button type="primary" icon={<PlusOutlined />}>
                        Add User
                    </Button>
                </Col>
            </Row>
        </Card>
    );
};

export default UsersFilter;
