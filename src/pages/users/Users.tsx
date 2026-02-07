import { Breadcrumb } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getUsers } from '../../http/api';
import { User } from '../../types';

const Users = () => {
    const {
        data: users,
        isLoading,
        isError,
        error,
    } = useQuery({
        queryKey: ['users'],
        queryFn: () => {
            return getUsers().then((res) => res.data);
        },
    });

    return (
        <>
            <Breadcrumb
                separator={<RightOutlined />}
                items={[{ title: <Link to="/">Dashboard</Link> }, { title: 'Users' }]}
            />
            {isLoading && <div>Loading...</div>}
            {isError && <div>{error.message}</div>}
            {users && (
                <div>
                    <ul>
                        {users.map((user: User) => (
                            <li key={user.id}>{user.firstName}</li>
                        ))}
                    </ul>
                </div>
            )}
        </>
    );
};

export default Users;
