import {
    Card,
    Col,
    Form,
    Input,
    message,
    Row,
    Select,
    Space,
    Switch,
    Typography,
    Upload,
    UploadProps,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Category, Tenant } from '../../../types';
import { useQuery } from '@tanstack/react-query';
import { getCategories, getTenants } from '../../../http/api';
import Pricing from './Pricing';
import Attributes from './Attributes';
import { useState } from 'react';
import { set } from 'lodash';

const ProductForm = () => {
    const [messageApi, contextHolder] = message.useMessage();
    const [imageUrl, setImageUrl] = useState<string | null>(null);

    const selectedCategory = Form.useWatch('categoryId');
    console.log(selectedCategory);
    const { data: categories } = useQuery({
        queryKey: ['categories'],
        queryFn: () => {
            return getCategories();
        },
    });

    const { data: restaurants } = useQuery({
        queryKey: ['restaurants'],
        queryFn: () => {
            return getTenants(`perPage=100&currentPage=1`);
        },
    });

    const uploaderConfig: UploadProps = {
        name: 'file',
        multiple: false,
        showUploadList: false,
        beforeUpload: (file) => {
            // Validation logic
            const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
            if (!isJpgOrPng) {
                console.error('You can only upload JPG/PNG file!');
                messageApi.error('You can only upload JPG/PNG file!');
            }

            //todo:  size validation.
            setImageUrl(URL.createObjectURL(file));

            return false;
        },
    };

    return (
        <Row>
            <Col span={24}>
                <Space direction="vertical" size="large">
                    <Card title="Product info" bordered={false}>
                        <Row gutter={20}>
                            <Col span={12}>
                                <Form.Item
                                    label="Product name"
                                    name="name"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Product name is required',
                                        },
                                    ]}>
                                    <Input size="large" />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item
                                    label="Category"
                                    name="categoryId"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Category is required',
                                        },
                                    ]}>
                                    <Select
                                        size="large"
                                        style={{ width: '100%' }}
                                        allowClear={true}
                                        onChange={() => {}}
                                        placeholder="Select category">
                                        {categories?.data.map((category: Category) => (
                                            <Select.Option
                                                value={JSON.stringify(category)}
                                                key={category._id}>
                                                {category.name}
                                            </Select.Option>
                                        ))}
                                    </Select>
                                </Form.Item>
                            </Col>
                            <Col span={24}>
                                <Form.Item
                                    label="Description"
                                    name="description"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Description is required',
                                        },
                                    ]}>
                                    <Input.TextArea
                                        rows={2}
                                        maxLength={100}
                                        style={{ resize: 'none' }}
                                        size="large"
                                    />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Card>
                    <Card title="Product image" bordered={false}>
                        <Row gutter={20}>
                            <Col span={12}>
                                <Form.Item
                                    label=""
                                    name="image"
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Please upload a product image',
                                        },
                                    ]}>
                                    {contextHolder}
                                    <Upload listType="picture-card" {...uploaderConfig}>
                                        {imageUrl ? (
                                            <img
                                                src={imageUrl}
                                                alt="avatar"
                                                style={{ width: '100%' }}
                                            />
                                        ) : (
                                            <Space direction="vertical">
                                                <PlusOutlined />
                                                <Typography.Text>Upload</Typography.Text>
                                            </Space>
                                        )}
                                    </Upload>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Card>

                    <Card title="Tenant info" bordered={false}>
                        <Row gutter={24}>
                            <Col span={24}>
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
                                        {restaurants?.data.data.map((tenant: Tenant) => (
                                            <Select.Option value={tenant.id} key={tenant.id}>
                                                {tenant.name}
                                            </Select.Option>
                                        ))}
                                    </Select>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Card>

                    {selectedCategory && <Pricing selectedCategory={selectedCategory} />}
                    {selectedCategory && <Attributes selectedCategory={selectedCategory} />}

                    <Card title="Other properties" bordered={false}>
                        <Row gutter={24}>
                            <Col span={24}>
                                <Space>
                                    <Form.Item name="isPublish">
                                        <Switch
                                            defaultChecked={false}
                                            onChange={() => {}}
                                            checkedChildren="Yes"
                                            unCheckedChildren="No"
                                        />
                                    </Form.Item>
                                    <Typography.Text style={{ marginBottom: 22, display: 'block' }}>
                                        Published
                                    </Typography.Text>
                                </Space>
                            </Col>
                        </Row>
                    </Card>
                </Space>
            </Col>
        </Row>
    );
};

export default ProductForm;
